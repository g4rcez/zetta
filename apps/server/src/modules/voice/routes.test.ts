import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createIdentityAccess } from "../identity/access";
import { createVoiceRoutes } from "./routes";
import { VoiceError, type VoiceCallHandle, type VoiceService, type VoiceSocket } from "./service";
import { createTicketStore } from "./tickets";

const ORIGIN = "https://app.example.invalid";
const access = createIdentityAccess(
  {
    api: {
      async getSession({ headers }) {
        const id = headers.get("x-test-user");
        return id ? { user: { id } } : null;
      },
    },
  },
  async () => ({ isAdmin: false }),
);

/** A voice service that only keeps tickets and echoes: what the routes do with a socket is what is tested here. */
const received: unknown[] = [];
const closedCalls: string[] = [];
const tickets = createTicketStore<{ userId: string }>();
const fake = {
  async capabilities() {
    return { voice: "on" as const, phone: "off" as const };
  },
  async ticket(actor: { userId: string }, conversationId: string) {
    if (conversationId === "00000000-0000-7000-8000-000000000001")
      throw new VoiceError("NOT_A_CHAT", "room");
    return { ticket: tickets.mint({ userId: actor.userId }), expiresInSeconds: 30 };
  },
  async open(ticket: string, socket: VoiceSocket): Promise<VoiceCallHandle | null> {
    const info = tickets.redeem(ticket);
    if (!info) {
      socket.close(4401, "no");
      return null;
    }
    socket.sendText({ type: "state", state: "listening" });
    return {
      id: "call-1",
      message: (d) => received.push(d instanceof Uint8Array ? d.byteLength : d),
      closed: () => closedCalls.push(info.userId),
    };
  },
} as unknown as VoiceService;

const app = new Elysia().use(createVoiceRoutes({ access, voice: fake }, [ORIGIN])).listen(0);
afterAll(() => void app.stop(true));
const base = () => `http://127.0.0.1:${app.server!.port}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-test-user": "u1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const connect = (ticket: string, origin: string | null = ORIGIN) =>
  new Promise<{ ws: WebSocket; messages: unknown[]; closed: Promise<{ code: number }> }>(
    (resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${app.server!.port}/api/voice/socket?ticket=${ticket}`,
        {
          headers: origin ? { origin } : {},
        } as never,
      );
      ws.binaryType = "arraybuffer";
      const messages: unknown[] = [];
      const closed = new Promise<{ code: number }>((r) =>
        ws.addEventListener("close", (e) => r({ code: e.code })),
      );
      ws.addEventListener("message", (e) =>
        messages.push(typeof e.data === "string" ? JSON.parse(e.data) : e.data),
      );
      ws.addEventListener("open", () => resolve({ ws, messages, closed }));
      ws.addEventListener("error", () => reject(new Error("socket refused")));
      closed.then(() => reject(new Error("socket closed before it opened")));
    },
  );

describe("voice routes", () => {
  test("capabilities need a signed-in person", async () => {
    expect((await fetch(`${base()}/api/voice/capabilities`)).status).toBe(401);
    const ok = await fetch(`${base()}/api/voice/capabilities`, {
      headers: { "x-test-user": "u1" },
    });
    expect(await ok.json()).toEqual({ voice: "on", phone: "off" });
  });

  test("a ticket needs a sign-in and a trusted origin, and a bad body or a refused chat is told", async () => {
    const chat = { conversationId: "00000000-0000-7000-8000-000000000002" };
    expect((await post("/api/voice/ticket", chat, { "x-test-user": "" })).status).toBe(401);
    expect(
      (await post("/api/voice/ticket", chat, { origin: "https://evil.example.invalid" })).status,
    ).toBe(403);
    expect((await post("/api/voice/ticket", { conversationId: "nope" })).status).toBe(400);
    expect(
      (await post("/api/voice/ticket", { conversationId: chat.conversationId, extra: 1 })).status,
    ).toBe(400);
    const room = await post("/api/voice/ticket", {
      conversationId: "00000000-0000-7000-8000-000000000001",
    });
    expect(room.status).toBe(409);
    expect(((await room.json()) as { error: { code: string } }).error.code).toBe(
      "VOICE_NOT_A_CHAT",
    );
    const good = await post("/api/voice/ticket", chat);
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ expiresInSeconds: 30 });
  });

  test("the socket opens with a ticket, carries both kinds of message, and tells the service when it closes", async () => {
    const { ticket } = (await (
      await post("/api/voice/ticket", { conversationId: "00000000-0000-7000-8000-000000000002" })
    ).json()) as {
      ticket: string;
    };
    const { ws, messages, closed } = await connect(ticket);
    ws.send(JSON.stringify({ type: "start", language: "en" }));
    ws.send(new Uint8Array(640));
    for (let i = 0; i < 100 && received.length < 2; i++) await Bun.sleep(10);
    expect(messages[0]).toEqual({ type: "state", state: "listening" });
    expect(received).toEqual([{ type: "start", language: "en" }, 640]);
    ws.close();
    await closed;
    for (let i = 0; i < 100 && !closedCalls.length; i++) await Bun.sleep(10);
    expect(closedCalls).toEqual(["u1"]);
  });

  test("a ticket works once, and a socket without a ticket is closed", async () => {
    const { ticket } = (await (
      await post("/api/voice/ticket", { conversationId: "00000000-0000-7000-8000-000000000002" })
    ).json()) as {
      ticket: string;
    };
    const first = await connect(ticket);
    first.ws.close();
    await first.closed;
    // The upgrade is accepted, then the service closes it with the "no valid ticket" code.
    for (const bad of [ticket, "nope"]) {
      const refused = await connect(bad);
      expect((await refused.closed).code).toBe(4401);
    }
  });

  test("a socket from another site, or with no origin, is refused before it opens", async () => {
    const { ticket } = (await (
      await post("/api/voice/ticket", { conversationId: "00000000-0000-7000-8000-000000000002" })
    ).json()) as {
      ticket: string;
    };
    await expect(connect(ticket, "https://evil.example.invalid")).rejects.toThrow();
    await expect(connect(ticket, null)).rejects.toThrow();
    // The refused attempts did not spend the ticket.
    const ok = await connect(ticket);
    ok.ws.close();
    await ok.closed;
  });
});

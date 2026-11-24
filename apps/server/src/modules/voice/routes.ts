import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { VOICE_LIMITS } from "./protocol";
import { CLOSE, VoiceError, type VoiceCallHandle, type VoiceService } from "./service";

export type VoiceServices = {
  access: ReturnType<typeof createIdentityAccess>;
  voice: VoiceService;
};

const ticketBody = z.strictObject({ conversationId: z.string().uuid() });

const STATUS: Record<VoiceError["code"], number> = {
  OFF: 503,
  NOT_FOUND: 404,
  NOT_A_CHAT: 409,
  RATE: 429,
};

/**
 * - `GET  /api/voice/capabilities`: whether voice is on (speech to text and text to speech are both set up) and whether phone calls are.
 * - `POST /api/voice/ticket {conversationId}`: signed in and origin-checked, for the person's own chat with a bot; answers a one-time
 *   ticket that expires in about 30 seconds.
 * - `GET  /api/voice/socket?ticket=`: the WebSocket (see protocol.ts). Browsers send no custom header on a WebSocket, so the ticket is the
 *   credential, and the Origin is checked again against cross-site sockets. Worker-only (worker-only.ts).
 */
export function createVoiceRoutes(
  { access, voice }: VoiceServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof VoiceError) return fail(STATUS[e.code], `VOICE_${e.code}`, e.safe);
    if (e instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Send the chat to talk in.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  type State = { handle?: VoiceCallHandle | null; waiting: unknown[]; closed: boolean };
  const sockets = new Map<object, State>();

  return new Elysia({ prefix: "/api/voice", normalize: false })
    .get(
      "/capabilities",
      g(async () => voice.capabilities()),
    )
    .post(
      "/ticket",
      g(async (c) => voice.ticket(c.actor, ticketBody.parse(c.body).conversationId)),
    )
    .ws("/socket", {
      // A call can be quiet for minutes (the person is muted, the bot works): the server pings, and the idle timer must not cut it.
      idleTimeout: 960,
      sendPings: true,
      maxPayloadLength: VOICE_LIMITS.maxFrameBytes,
      beforeHandle({ request }) {
        // An upgrade from another site is refused before it is accepted.
        const origin = request.headers.get("origin");
        if (!origin || !trustedOrigins.includes(origin))
          return fail(
            403,
            "UNTRUSTED_ORIGIN",
            "Open Zetta from its trusted application and try again.",
          );
      },
      async open(ws) {
        const state: State = { waiting: [], closed: false };
        sockets.set(ws.raw, state);
        const handle = await voice
          .open(String((ws.data.query as Record<string, unknown>).ticket ?? ""), {
            sendText: (m) => void ws.raw.send(JSON.stringify(m)),
            sendBinary: (b) => void ws.raw.send(b),
            ping: () => void ws.raw.ping(),
            close: (code, reason) => ws.raw.close(code, reason.slice(0, 100)),
          })
          .catch(() => {
            ws.raw.close(CLOSE.badTicket, "The call could not start.");
            return null;
          });
        state.handle = handle;
        if (state.closed) return void handle?.closed();
        // Messages that came in while the call was being set up.
        for (const m of state.waiting.splice(0)) handle?.message(m);
      },
      message(ws, message) {
        const state = sockets.get(ws.raw);
        if (!state) return;
        if (state.handle === undefined) state.waiting.push(message);
        else state.handle?.message(message);
      },
      close(ws) {
        const state = sockets.get(ws.raw);
        sockets.delete(ws.raw);
        if (!state) return;
        state.closed = true;
        state.handle?.closed();
      },
    }) as unknown as Elysia;
}

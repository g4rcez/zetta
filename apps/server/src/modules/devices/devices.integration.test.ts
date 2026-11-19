import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { device } from "@zetta/db/schema/devices";
import { membership } from "@zetta/db/schema/identity";
import { eq } from "@zetta/db/query";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMachineService } from "../computer/machines";
import {
  issueBackgroundActor,
  createIdentityAccess,
  createMembershipLookup,
} from "../identity/access";
import { createDeviceHub } from "./hub";
import { createDeviceService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `dev-a-${uuidv7()}`;
const B = `dev-b-${uuidv7()}`;
const ids = [A, B];

suite("devices against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = createMembershipLookup(db);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    lookup,
  );
  const hub = createDeviceHub({ timeoutMs: 2_000 });
  const devices = createDeviceService({ db, hub, maxPerUser: 3 });
  const machines = createMachineService({
    db,
    connections: {} as never,
    runner: {} as never,
    devices,
  });
  const stubAuth = {
    $context: Promise.resolve({ baseURL: "http://127.0.0.1/api/auth" }),
    api: { getJwks: async () => ({ keys: [] }) },
    handler: () => new Response("n/a"),
  };
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    devices: {
      access,
      devices,
      hub,
      auth: stubAuth as never,
      resource: "http://127.0.0.1/api/mcp",
      actorFor: (id) => issueBackgroundActor(lookup, id),
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  let botA = "";
  let botA2 = "";
  let botB = "";
  const actor = (id: string) => issueBackgroundActor(lookup, id).then((a) => a!);
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };
  /** A computer that answers requests the way the desktop app does. */
  const answering = (
    id: string,
    reply: (method: string, params: Record<string, unknown>) => unknown,
  ) => {
    const sock = {
      send: (data: string) => {
        const m = JSON.parse(data) as {
          id: string;
          method: string;
          params: Record<string, unknown>;
        };
        queueMicrotask(() =>
          hub.receive(id, JSON.stringify({ id: m.id, ...(reply(m.method, m.params) as object) })),
        );
      },
      close() {},
    };
    hub.attach(id, sock);
    return sock;
  };

  beforeAll(async () => {
    const now = new Date();
    await db
      .insert(user)
      .values(
        ids.map((id) => ({
          id,
          name: id,
          email: `${id}@example.invalid`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })),
      );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    const mk = async (ownerUserId: string, name: string) =>
      (
        await db
          .insert(bot)
          .values({
            ownerUserId,
            kind: "specialist",
            visibility: "private",
            name,
            slug: `${name}-${uuidv7().slice(-8)}`,
          })
          .returning({ id: bot.id })
      )[0]!.id;
    botA = await mk(A, "ops");
    botA2 = await mk(A, "docs");
    botB = await mk(B, "theirs");
  });
  afterAll(async () => {
    await db.$client.query("delete from device where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids);
  });

  test("pairing gives a credential once, and only its hash is stored", async () => {
    const made = await devices.create(await actor(A), { name: "Work Mac", platform: "darwin" });
    expect(made.credential.startsWith("zdv_")).toBe(true);
    const [row] = await db.select().from(device).where(eq(device.id, made.device.id));
    expect(row!.credentialHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(made.credential);
    expect(await devices.authenticate(made.credential)).toMatchObject({
      id: made.device.id,
      ownerUserId: A,
    });
    expect(await devices.authenticate(`${made.credential}x`)).toBeNull();
    expect(await devices.authenticate("zdv_nope")).toBeNull();
    expect(await devices.authenticate("")).toBeNull();
  });

  test("pairing the same name again replaces the credential: the old one stops working and its connection closes", async () => {
    const first = await devices.create(await actor(A), { name: "Laptop", platform: "linux" });
    let closed = 0;
    hub.attach(first.device.id, { send() {}, close: () => void closed++ });
    const second = await devices.create(await actor(A), { name: "Laptop", platform: "linux" });
    expect(second.device.id).toBe(first.device.id);
    expect(closed).toBe(1);
    expect(await devices.authenticate(first.credential)).toBeNull();
    expect(await devices.authenticate(second.credential)).toMatchObject({ id: first.device.id });
    await devices.revoke(await actor(A), "Laptop");
  });

  test("a name must be plain, a platform known, and a person has a limit", async () => {
    const a = await actor(A);
    for (const bad of [
      { name: "", platform: "darwin" },
      { name: "x".repeat(61), platform: "darwin" },
      { name: "Mac", platform: "plan9" },
      { name: "a/b", platform: "linux" },
    ])
      await expect(devices.create(a, bad)).rejects.toMatchObject({ code: "INVALID" });
    // A (limit 3) holds "Work Mac" already.
    await devices.create(a, { name: "Desk", platform: "linux" });
    await devices.create(a, { name: "Server", platform: "linux" });
    await expect(devices.create(a, { name: "Fourth", platform: "linux" })).rejects.toMatchObject({
      code: "LIMIT",
    });
    await devices.revoke(a, "Desk");
    await devices.revoke(a, "Server");
  });

  test("the list is the person's own, with who is online", async () => {
    const mine = await call(A, "GET", "/api/devices");
    expect(mine.status).toBe(200);
    expect(mine.json.devices.map((d: { name: string }) => d.name)).toEqual(["Work Mac"]);
    expect(mine.json.devices[0].online).toBe(false);
    expect((await call(B, "GET", "/api/devices")).json.devices).toEqual([]);
    expect((await call("", "GET", "/api/devices")).status).toBe(401);
  });

  test("a bot reaches a device only when the owner shared it, by the same call as a machine", async () => {
    const a = await actor(A);
    const [work] = await devices.list(A);
    const ctx = { botId: botA, botName: "ops" };
    const asked: { method: string; params: Record<string, unknown> }[] = [];
    answering(
      work!.id,
      (method, params) => (
        asked.push({ method, params }),
        { result: { output: "Darwin\n", exitCode: 0 } }
      ),
    );

    // Not shared yet: the bot cannot tell it exists.
    await expect(
      machines.exec(a, "Work Mac", { type: "run", command: "uname" }, ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await machines.catalog(A, botA)).toEqual([]);

    const shared = await call(A, "PATCH", `/api/devices/${work!.id}`, { botIds: [botA] });
    expect(shared.json.device.botIds).toEqual([botA]);
    expect(await machines.catalog(A, botA)).toEqual([
      { name: "Work Mac", kind: "device", target: "darwin" },
    ]);
    const result = await machines.exec(a, "Work Mac", { type: "run", command: "uname" }, ctx);
    expect(result).toEqual({
      exitCode: 0,
      output: "Darwin\n",
      truncated: false,
      machine: "Work Mac",
    });
    expect(asked).toEqual([
      { method: "run", params: { command: "uname", bot: "ops", botId: botA } },
    ]);

    // Another bot of the same owner was not given it.
    await expect(
      machines.exec(a, "Work Mac", { type: "run", command: "uname" }, { botId: botA2 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Files are not carried by devices.
    await expect(
      machines.exec(a, "Work Mac", { type: "get", remote: "/x", local: "/y" }, ctx),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const listed = await machines.exec(a, "Work Mac", { type: "list", path: "/tmp" }, ctx);
    expect(asked.at(-1)).toMatchObject({ method: "list", params: { path: "/tmp" } });
    expect(listed.exitCode).toBe(0);
  });

  test("a person cannot share a device with someone else's bot, nor reach another person's device", async () => {
    const [work] = await devices.list(A);
    expect((await call(A, "PATCH", `/api/devices/${work!.id}`, { botIds: [botB] })).status).toBe(
      400,
    );
    expect((await call(B, "PATCH", `/api/devices/${work!.id}`, { botIds: [botB] })).status).toBe(
      404,
    );
    expect((await call(B, "DELETE", `/api/devices/${work!.id}`)).status).toBe(404);
    await expect(
      machines.exec(await actor(B), "Work Mac", { type: "run", command: "id" }, { botId: botB }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a refusal at the computer reaches the bot as DENIED; a computer that is off is unreachable", async () => {
    const a = await actor(A);
    const [work] = await devices.list(A);
    answering(work!.id, () => ({ error: { code: "DENIED" } }));
    await expect(
      machines.exec(a, "Work Mac", { type: "run", command: "rm -rf x" }, { botId: botA }),
    ).rejects.toMatchObject({ code: "DENIED" });
    hub.drop(work!.id);
    await expect(
      machines.exec(a, "Work Mac", { type: "run", command: "ls" }, { botId: botA }),
    ).rejects.toMatchObject({ code: "UNREACHABLE" });
  });

  test("output is capped before it reaches the bot", async () => {
    const a = await actor(A);
    const [work] = await devices.list(A);
    answering(work!.id, () => ({ result: { output: "x".repeat(200_000), exitCode: 0 } }));
    const r = await machines.exec(a, "Work Mac", { type: "run", command: "yes" }, { botId: botA });
    expect(r.output).toHaveLength(64 * 1024);
    expect(r.truncated).toBe(true);
    hub.drop(work!.id);
  });

  test("pairing over HTTP needs an access token; revoking closes the connection and removes the grants", async () => {
    const noToken = await app.handle(
      new Request("http://localhost/api/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", platform: "linux" }),
      }),
    );
    expect(noToken.status).toBe(401);
    const [work] = await devices.list(A);
    let closed = 0;
    hub.attach(work!.id, { send() {}, close: () => void closed++ });
    expect((await call(A, "DELETE", `/api/devices/${work!.id}`)).status).toBe(200);
    expect(closed).toBe(1);
    expect(await devices.list(A)).toEqual([]);
    expect(await devices.catalog(A, botA)).toEqual([]);
    expect(await devices.authenticate("zdv_anything")).toBeNull();
  });

  test("over a real WebSocket: only a paired credential connects, requests reach the app and its answers come back, revoking closes it", async () => {
    const a = await actor(A);
    const made = await devices.create(a, { name: "Socket Mac", platform: "darwin" });
    await devices.setBots(a, made.device.id, [botA]);
    app.listen({ port: 0, hostname: "127.0.0.1" });
    const base = `ws://127.0.0.1:${app.server!.port}/api/devices/connect`;
    try {
      const open = (credential: string) =>
        new Promise<WebSocket | "refused">((resolve) => {
          const ws = new WebSocket(base, {
            headers: { authorization: `Bearer ${credential}` },
          } as never);
          ws.onopen = () => resolve(ws);
          ws.onerror = () => resolve("refused");
        });
      expect(await open("zdv_wrong")).toBe("refused");
      expect(await open("")).toBe("refused");

      const ws = (await open(made.credential)) as WebSocket;
      expect(ws).not.toBe("refused");
      const received: { id: string; method: string; params: Record<string, unknown> }[] = [];
      ws.onmessage = (event) => {
        const m = JSON.parse(String(event.data)) as (typeof received)[number];
        received.push(m);
        ws.send(JSON.stringify({ id: m.id, result: { output: "from the app\n", exitCode: 0 } }));
      };
      for (let i = 0; i < 50 && !hub.online(made.device.id); i++) await Bun.sleep(20);
      expect(hub.online(made.device.id)).toBe(true);
      ws.send("ping");

      const r = await machines.exec(
        a,
        "Socket Mac",
        { type: "run", command: "echo hi" },
        { botId: botA, botName: "ops" },
      );
      expect(r).toMatchObject({ exitCode: 0, output: "from the app\n", machine: "Socket Mac" });
      expect(received[0]).toMatchObject({
        method: "run",
        params: { command: "echo hi", bot: "ops" },
      });
      expect((await devices.list(A)).find((d) => d.id === made.device.id)).toMatchObject({
        online: true,
      });

      const closed = new Promise<void>((resolve) => (ws.onclose = () => resolve()));
      await devices.revoke(a, made.device.id);
      await closed;
      expect(hub.online(made.device.id)).toBe(false);
      expect(await open(made.credential)).toBe("refused");
    } finally {
      app.stop(true);
    }
  });
});

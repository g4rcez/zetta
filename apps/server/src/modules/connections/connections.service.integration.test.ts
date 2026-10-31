import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { sealedFor } from "../../test-support/sealed";
import { createChatService } from "../chat/service";
import { createTurnRunner } from "../chat/pipeline";
import { createIdentityAccess } from "../identity/access";
import { createConnectionsService } from "./service";
import { createConnectionStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url?.endsWith("/zetta_test") ? describe : describe.skip; // initializes a key check: only ever against the dedicated test database
const ids = [`conn-a-${uuidv7()}`, `conn-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const KEY = Buffer.alloc(32, 7).toString("base64");

suite("connections wired into bots and runs", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
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
  const seenEnv: Record<string, string | undefined>[] = [];
  const cli = async () => "unused";
  const stream = async function* (t: { prompt: string; extraEnv?: Record<string, string> }) {
    seenEnv.push({ ANTHROPIC_API_KEY: t.extraEnv?.ANTHROPIC_API_KEY });
    yield "ok";
  };
  let app: ReturnType<typeof createApp>;
  let connections: ReturnType<typeof createConnectionsService>;
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
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
    return {
      status: r.status,
      text: await r.clone().text(),
      json: (await r.json().catch(() => ({}))) as any,
    };
  };
  beforeAll(async () => {
    const store = await createConnectionStore(db, {
      configuration: { key: KEY, keyId: "v1" },
      allowedProviders: ["anthropic", "openai"],
      initializeEmpty: true,
    });
    connections = createConnectionsService(db, store);
    const chat = createChatService(
      db,
      createTurnRunner(db, cli as never, stream as never),
      undefined,
      undefined,
      undefined,
      connections,
    );
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: { access, chat },
      connections: { access, connections },
      webOrigin: "http://web.test",
      desktopOrigins: [],
      drain: () => {},
    });
    const now = new Date();
    await db
      .insert(user)
      .values(
        ids.map((id) => ({
          id,
          name: id,
          email: `${id}@t.test`,
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
  });
  afterAll(async () => {
    await db.$client.query("delete from bot_connection where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(
      db,
      ids.map((x) => x),
    ).catch(() => undefined);
  });

  test("A cannot see or bind B's connections; responses never contain the secret; revocation fails the run closed", async () => {
    const SECRET = "sk-ant-test-secret-value-1234567890";
    const bot = (
      await call(A, "POST", "/api/bots", {
        name: "Claudey",
        harness: "claude-code",
        requiredConnections: [{ key: "main", provider: "anthropic" }],
      })
    ).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const created = await call(A, "POST", "/api/connections", {
      provider: "anthropic",
      label: "My key",
      sealed: await sealedFor(A, "connection.create:anthropic", { secret: SECRET }),
    });
    expect(created.status).toBe(201);
    expect(created.text).not.toContain(SECRET);
    const connId = created.json.connection.id as string;
    expect((await call(A, "GET", "/api/connections")).text).not.toContain(SECRET);
    expect((await call(B, "GET", "/api/connections")).json.connections).toHaveLength(0);
    // another user cannot bind A's connection (not theirs) even to a bot they can use
    expect(
      (await call(B, "PUT", `/api/bots/${bot.id}/connections/main`, { connectionId: connId }))
        .status,
    ).toBe(404);
    // no binding yet -> the run fails closed with setup guidance, and nothing was injected
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id;
    const say = () => call(A, "POST", `/api/conversations/${conv}/messages`, { content: "hi" });
    let r = await say();
    expect(r.json.assistant.status).toBe("failed");
    expect(r.json.assistant.content).toContain("needs your account connected");
    expect(seenEnv).toHaveLength(0);
    expect(
      (await call(A, "GET", `/api/bots/${bot.id}/connections`)).json.requirements[0].status,
    ).toBe("missing");
    expect(
      (await call(A, "PUT", `/api/bots/${bot.id}/connections/main`, { connectionId: connId }))
        .status,
    ).toBe(200);
    expect(
      (await call(A, "GET", `/api/bots/${bot.id}/connections`)).json.requirements[0].status,
    ).toBe("ready");
    r = await say();
    expect(r.json.assistant.status).toBe("complete");
    expect(seenEnv.at(-1)!.ANTHROPIC_API_KEY).toBe(SECRET); // injected for this run only
    expect(r.text).not.toContain(SECRET);
    // the run that read the credential is audited, with the bot and the connection, and without any secret
    const used = await db.$client.query(
      "select bot_id, subject_id, detail from audit_event where owner_user_id = $1 and kind = 'connection' and detail = 'used'",
      [A],
    );
    expect(used.rows).toEqual([{ bot_id: bot.id, subject_id: connId, detail: "used" }]);
    // revoke -> no new resolution, no fallback to anything else
    expect(
      (await call(A, "POST", `/api/connections/${connId}/revoke`, { expectedRevision: 1 })).json
        .connection.state,
    ).toBe("revoked");
    const before = seenEnv.length;
    r = await say();
    expect(r.json.assistant.status).toBe("failed");
    expect(seenEnv).toHaveLength(before);
    expect(
      (await call(A, "GET", `/api/bots/${bot.id}/connections`)).json.requirements[0].status,
    ).toBe("unusable");
    // provider mismatch cannot be bound
    const other = (
      await call(A, "POST", "/api/connections", {
        provider: "openai",
        label: "oa",
        sealed: await sealedFor(A, "connection.create:openai", {
          secret: "sk-openai-secret-123456",
        }),
      })
    ).json.connection.id;
    expect(
      (await call(A, "PUT", `/api/bots/${bot.id}/connections/main`, { connectionId: other }))
        .status,
    ).toBe(404);
  });

  test("a shared bot holds only references: each user binds their own connection", async () => {
    const bot = (
      await call(A, "POST", "/api/bots", {
        name: "SharedKey",
        harness: "claude-code",
        requiredConnections: [{ key: "main", provider: "anthropic" }],
      })
    ).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot]);
    const bConn = (
      await call(B, "POST", "/api/connections", {
        provider: "anthropic",
        label: "B key",
        sealed: await sealedFor(B, "connection.create:anthropic", {
          secret: "sk-ant-B-secret-0987654321",
        }),
      })
    ).json.connection.id;
    await call(B, "PUT", `/api/bots/${bot}/connections/main`, { connectionId: bConn });
    const conv = (await call(B, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    // Running someone else's bot with your own key is only allowed when bots are isolated in Docker.
    const prevRuntime = process.env.ZETTA_HARNESS_RUNTIME;
    process.env.ZETTA_HARNESS_RUNTIME = "docker";
    try {
      const rr = await call(B, "POST", `/api/conversations/${conv}/messages`, { content: "hi" });
      expect(rr.json.assistant.status).toBe("complete");
    } finally {
      if (prevRuntime === undefined) delete process.env.ZETTA_HARNESS_RUNTIME;
      else process.env.ZETTA_HARNESS_RUNTIME = prevRuntime;
    }
    expect(seenEnv.at(-1)!.ANTHROPIC_API_KEY).toBe("sk-ant-B-secret-0987654321"); // B's key, never A's
    expect((await call(A, "GET", `/api/bots/${bot}/connections`)).json.requirements[0].status).toBe(
      "missing",
    ); // A never bound a connection to this bot: B's binding is invisible to A
  });

  test("a credential is accepted only sealed to the server key, for this user and this purpose", async () => {
    const SECRET = "sk-ant-test-sealed-1234567890";
    const create = (body: unknown) =>
      call(A, "POST", "/api/connections", {
        provider: "anthropic",
        label: "sealed",
        ...(body as object),
      });
    const key = (await call(A, "GET", "/api/connections/transport-key")).json;
    expect(key.publicKey).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(key.publicKey.d).toBeUndefined();
    expect([key.userId, typeof key.serverTime]).toEqual([A, "number"]);
    const plain = await create({ secret: SECRET });
    expect(plain.status).toBe(400);
    expect(plain.text).not.toContain(SECRET);
    expect(
      (await create({ sealed: await sealedFor(A, "connection.create:openai", { secret: SECRET }) }))
        .status,
    ).toBe(400); // another provider: another purpose
    expect(
      (
        await create({
          sealed: await sealedFor(B, "connection.create:anthropic", { secret: SECRET }),
        })
      ).status,
    ).toBe(400); // sealed for another user
    const unknownKey = await create({
      sealed: {
        ...(await sealedFor(A, "connection.create:anthropic", { secret: SECRET })),
        kid: "k000000000000",
      },
    });
    expect([unknownKey.status, unknownKey.json.error.code]).toEqual([409, "TRANSPORT_KEY_EXPIRED"]);
    const ok = await create({
      sealed: await sealedFor(A, "connection.create:anthropic", { secret: SECRET }),
    });
    expect(ok.status).toBe(201);
    expect(ok.text).not.toContain(SECRET);
  });

  test("purging a user also removes their bot bindings and leaves other users alone", async () => {
    const bot = (
      await call(A, "POST", "/api/bots", {
        name: "Purged",
        harness: "claude-code",
        requiredConnections: [{ key: "main", provider: "anthropic" }],
      })
    ).json.bot.id as string;
    const mine = (
      await call(A, "POST", "/api/connections", {
        provider: "anthropic",
        label: "mine",
        sealed: await sealedFor(A, "connection.create:anthropic", {
          secret: "sk-ant-purge-mine-123456",
        }),
      })
    ).json.connection.id as string;
    const theirs = (
      await call(B, "POST", "/api/connections", {
        provider: "anthropic",
        label: "theirs",
        sealed: await sealedFor(B, "connection.create:anthropic", {
          secret: "sk-ant-purge-theirs-1234",
        }),
      })
    ).json.connection.id as string;
    expect(
      (await call(A, "PUT", `/api/bots/${bot}/connections/main`, { connectionId: mine })).status,
    ).toBe(200);

    await connections.purgeOwner(A);

    const left = async (sql: string, id: string) =>
      (await db.$client.query(sql, [id])).rows[0].n as number;
    expect([
      await left("select count(*)::int as n from bot_connection where owner_user_id = $1", A),
      await left("select count(*)::int as n from connection where owner_user_id = $1", A),
    ]).toEqual([0, 0]);
    expect(await left("select count(*)::int as n from connection where id = $1", theirs)).toBe(1);
  });
});

import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
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
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  const seenEnv: Record<string, string | undefined>[] = [];
  const cli = async () => "unused";
  const stream = async function* (t: { prompt: string; extraEnv?: Record<string, string> }) { seenEnv.push({ ANTHROPIC_API_KEY: t.extraEnv?.ANTHROPIC_API_KEY }); yield "ok"; };
  let app: ReturnType<typeof createApp>;
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, text: await r.clone().text(), json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const store = await createConnectionStore(db, { configuration: { key: KEY, keyId: "v1" }, allowedProviders: ["anthropic", "openai"], initializeEmpty: true });
    const connections = createConnectionsService(db, store);
    const chat = createChatService(db, createTurnRunner(db, cli as never, stream as never), undefined, undefined, undefined, connections);
    app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat }, connections: { access, connections }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => {
    await db.$client.query("delete from bot_connection where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids.map((x) => x)).catch(() => undefined);
  });

  test("A cannot see or bind B's connections; responses never contain the secret; revocation fails the run closed", async () => {
    const SECRET = "sk-ant-test-secret-value-1234567890";
    const bot = (await call(A, "POST", "/api/bots", { name: "Claudey", harness: "claude-code", requiredConnections: [{ key: "main", provider: "anthropic" }] })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const created = await call(A, "POST", "/api/connections", { provider: "anthropic", label: "My key", secret: SECRET });
    expect(created.status).toBe(201); expect(created.text).not.toContain(SECRET);
    const connId = created.json.connection.id as string;
    expect((await call(A, "GET", "/api/connections")).text).not.toContain(SECRET);
    expect((await call(B, "GET", "/api/connections")).json.connections).toHaveLength(0);
    // another user cannot bind A's connection (not theirs) even to a bot they can use
    expect((await call(B, "PUT", `/api/bots/${bot.id}/connections/main`, { connectionId: connId })).status).toBe(404);
    // no binding yet -> the run fails closed with setup guidance, and nothing was injected
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot.id })).json.conversation.id;
    const say = () => call(A, "POST", `/api/conversations/${conv}/messages`, { content: "hi" });
    let r = await say(); expect(r.json.assistant.status).toBe("failed"); expect(r.json.assistant.content).toContain("needs your account connected"); expect(seenEnv).toHaveLength(0);
    expect((await call(A, "GET", `/api/bots/${bot.id}/connections`)).json.requirements[0].status).toBe("missing");
    expect((await call(A, "PUT", `/api/bots/${bot.id}/connections/main`, { connectionId: connId })).status).toBe(200);
    expect((await call(A, "GET", `/api/bots/${bot.id}/connections`)).json.requirements[0].status).toBe("ready");
    r = await say(); expect(r.json.assistant.status).toBe("complete"); expect(seenEnv.at(-1)!.ANTHROPIC_API_KEY).toBe(SECRET); // injected for this run only
    expect(r.text).not.toContain(SECRET);
    // revoke -> no new resolution, no fallback to anything else
    expect((await call(A, "POST", `/api/connections/${connId}/revoke`, { expectedRevision: 1 })).json.connection.state).toBe("revoked");
    const before = seenEnv.length;
    r = await say(); expect(r.json.assistant.status).toBe("failed"); expect(seenEnv).toHaveLength(before);
    expect((await call(A, "GET", `/api/bots/${bot.id}/connections`)).json.requirements[0].status).toBe("unusable");
    // provider mismatch cannot be bound
    const other = (await call(A, "POST", "/api/connections", { provider: "openai", label: "oa", secret: "sk-openai-secret-123456" })).json.connection.id;
    expect((await call(A, "PUT", `/api/bots/${bot.id}/connections/main`, { connectionId: other })).status).toBe(404);
  });

  test("a shared bot holds only references: each user binds their own connection", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "SharedKey", harness: "claude-code", requiredConnections: [{ key: "main", provider: "anthropic" }] })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot]);
    const bConn = (await call(B, "POST", "/api/connections", { provider: "anthropic", label: "B key", secret: "sk-ant-B-secret-0987654321" })).json.connection.id;
    await call(B, "PUT", `/api/bots/${bot}/connections/main`, { connectionId: bConn });
    const conv = (await call(B, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    // Running someone else's bot with your own key is only allowed when bots are isolated in Docker.
    const prevRuntime = process.env.ZETTA_HARNESS_RUNTIME; process.env.ZETTA_HARNESS_RUNTIME = "docker";
    try { const rr = await call(B, "POST", `/api/conversations/${conv}/messages`, { content: "hi" }); expect(rr.json.assistant.status).toBe("complete"); } finally { if (prevRuntime === undefined) delete process.env.ZETTA_HARNESS_RUNTIME; else process.env.ZETTA_HARNESS_RUNTIME = prevRuntime; }
    expect(seenEnv.at(-1)!.ANTHROPIC_API_KEY).toBe("sk-ant-B-secret-0987654321"); // B's key, never A's
    expect((await call(A, "GET", `/api/bots/${bot}/connections`)).json.requirements[0].status).toBe("missing"); // A never bound a connection to this bot: B's binding is invisible to A
  });
});

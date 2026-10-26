import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createKnowledge } from "../features/knowledge";
import { createIdentityAccess } from "../identity/access";
import { createChatService } from "./service";

// Opt-in: spends Claude Code quota (haiku). ZETTA_REAL_HARNESS_TEST=1 plus a database URL. Claude is the only harness verified live for memory.
const enabled = process.env.ZETTA_REAL_HARNESS_TEST === "1" && process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = enabled ? describe : describe.skip;
const A = `rmem-a-${crypto.randomUUID()}`, B = `rmem-b-${crypto.randomUUID()}`;
let current = A;

suite("real claude haiku: memory is written through the tool, recalled in a new chat, and private per user", () => {
  const db = createDb({ DATABASE_URL: process.env.ZETTA_CHAT_TEST_DATABASE_URL ?? "postgresql://unused@localhost/unused" } as never);
  const knowledge = createKnowledge(db);
  const access = createIdentityAccess({ api: { async getSession() { return { user: { id: current } }; } } }, async () => ({ isAdmin: false }));
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat: createChatService(db) }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    current = as;
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    for (const id of [A, B]) { await db.insert(user).values({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now }); await db.insert(membership).values({ userId: id, status: "active", joinedAt: now, updatedAt: now }); }
  });
  afterAll(async () => { await cleanupTestUsers(db, [A, B]); });

  test("A's fact is stored via zetta:remember, shows in A's next chat, and never reaches B", async () => {
    const botA = (await call(A, "POST", "/api/bots", { name: "MemA", harness: "claude-code", model: "haiku" })).json.bot.id as string;
    const botB = (await call(B, "POST", "/api/bots", { name: "MemB", harness: "claude-code", model: "haiku" })).json.bot.id as string;
    const c1 = (await call(A, "POST", "/api/conversations", { botId: botA })).json.conversation.id as string;
    const w = await call(A, "POST", `/api/conversations/${c1}/messages`, { content: 'Please store this about me with the zetta:remember tool, target "user": "My favourite city is Lisbon". Then confirm in one short sentence.' });
    expect(w.status).toBe(201);
    const stored = (await knowledge.snapshot(A, botA)).user.map((m) => m.content).join(" | ");
    expect(stored.toLowerCase()).toContain("lisbon");
    const c2 = (await call(A, "POST", "/api/conversations", { botId: botA })).json.conversation.id as string;
    const r = await call(A, "POST", `/api/conversations/${c2}/messages`, { content: "What is my favourite city? Answer with just the city name." });
    expect(r.json.assistant.content.toLowerCase()).toContain("lisbon");
    const cb = (await call(B, "POST", "/api/conversations", { botId: botB })).json.conversation.id as string;
    const rb = await call(B, "POST", `/api/conversations/${cb}/messages`, { content: "What is my favourite city? If you do not know, say UNKNOWN." });
    expect(rb.json.assistant.content.toLowerCase()).not.toContain("lisbon");
    const sb = await knowledge.snapshot(B, botB); expect([...sb.user, ...sb.memory]).toHaveLength(0);
  }, 300_000);
});

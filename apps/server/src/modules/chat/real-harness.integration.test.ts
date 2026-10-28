import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createChatService } from "./service";

// Opt-in: spends Claude Code quota (haiku). ZETTA_REAL_HARNESS_TEST=1 plus a database URL.
const enabled = process.env.ZETTA_REAL_HARNESS_TEST === "1" && process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = enabled ? describe : describe.skip;
const id = `real-${uuidv7()}`;

suite("real claude-code haiku follows the Zetta tool protocol", () => {
  const db = createDb({ DATABASE_URL: process.env.ZETTA_CHAT_TEST_DATABASE_URL ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession() { return { user: { id } }; } } }, async () => ({ isAdmin: false }));
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat: createChatService(db) }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(membership).values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => { await cleanupTestUsers(db, [id]); });

  test("proposes a personality change and remembers a fact", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Real", harness: "claude-code", model: "haiku" })).json.bot as { id: string };
    const c = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation.id as string;
    const r = await call("POST", `/api/conversations/${c}/messages`, { content: `Please propose a config change for yourself (bot id ${bot.id}) so your personality becomes "cheerful and brief". Use the zetta:config tool. Also remember that my favourite city is Lisbon using zetta:remember.` });
    expect(r.status).toBe(201);
    const proposals = (await call("GET", "/api/proposals")).json.proposals;
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].diff[0].field).toBe("personality");
    expect(r.json.assistant.content).not.toContain("zetta:");
  }, 180_000);
});

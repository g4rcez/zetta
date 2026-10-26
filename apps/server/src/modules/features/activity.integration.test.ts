import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createFeaturesService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`feat-act-a-${crypto.randomUUID()}`, `feat-act-b-${crypto.randomUUID()}`];
const [A, B] = ids as [string, string];
const CANARY = "CANARY-SECRET-sk-abcdefghijklmnopqrstuvwxyz";

suite("activity trail and harness readiness", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat: createChatService(db) }, features: { access, features: createFeaturesService(db) }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, text: await r.clone().text(), json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => { await cleanupTestUsers(db, ids); });

  test("runs, tools and approvals are audited with closed codes only; secrets never appear; strictly owner-scoped", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Audited", harness: "cursor" })).json.bot.id as string; // cursor-agent is not installed
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation.id as string;
    await call(A, "POST", `/api/conversations/${conv}/messages`, { content: `please use ${CANARY} and open https://secret.example/${CANARY}` });
    await call(A, "POST", `/api/conversations/${conv}/messages`, { content: "/browse https://example.com" });
    const act = await call(A, "GET", "/api/activity");
    expect(act.status).toBe(200);
    const kinds = act.json.events.map((e: { kind: string; outcome: string }) => `${e.kind}:${e.outcome}`);
    expect(kinds).toContain("harness_run:not_installed");
    expect(act.text).not.toContain(CANARY); expect(act.text).not.toContain("secret.example"); expect(act.text).not.toContain("please use");
    const raw = (await db.$client.query("select * from audit_event where owner_user_id = $1", [A])).rows;
    expect(JSON.stringify(raw)).not.toContain(CANARY);
    for (const e of raw) expect(e.detail === null || /^[a-z0-9_:.-]{1,40}$/.test(e.detail)).toBe(true);
    expect((await call(B, "GET", "/api/activity")).json.events).toHaveLength(0);
    expect((await call(A, "GET", "/api/activity?limit=1")).json.events).toHaveLength(1);
  });

  test("harness readiness distinguishes not installed / unverified / needs login and never returns paths", async () => {
    const r = await call(A, "GET", "/api/harnesses");
    expect(r.status).toBe(200);
    const byName = Object.fromEntries(r.json.harnesses.map((h: { harness: string }) => [h.harness, h]));
    expect(Object.keys(byName).sort()).toEqual(["claude-code", "codex", "cursor", "omp", "opencode", "pi"]);
    expect(byName.cursor.status).toBe("not_installed"); expect(byName.cursor.guidance).toContain("administrator");
    for (const h of Object.values(byName) as { installed: boolean; status: string }[]) if (h.installed) expect(["unverified", "needs_login", "ready"]).toContain(h.status);
    expect(r.text).not.toMatch(/\/Users\/|\/opt\/|\/usr\//); // no filesystem paths
    // a recorded auth failure flips an installed harness to needs_login for that user only
    const piBot = (await call(A, "POST", "/api/bots", { name: "PiBot", harness: "pi" })).json.bot.id;
    await db.$client.query("insert into audit_event (owner_user_id, kind, outcome, bot_id, detail) values ($1,'harness_run','auth_required',$2,'pi')", [A, piBot]);
    const after = (await call(A, "GET", "/api/harnesses")).json.harnesses.find((h: { harness: string }) => h.harness === "pi");
    if (after.installed) expect(after.status).toBe("needs_login");
    expect((await call(B, "GET", "/api/harnesses")).json.harnesses.find((h: { harness: string }) => h.harness === "pi").status).not.toBe("needs_login");
  });
});

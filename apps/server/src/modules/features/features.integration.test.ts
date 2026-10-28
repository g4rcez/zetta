import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createFeaturesService } from "./service";
import { nextDailyRun } from "./schedule";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`feat-a-${uuidv7()}`, `feat-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

describe("schedule", () => {
  test("daily run honours timezone and DST", () => {
    // 2026-03-08 US spring-forward: 09:00 New York is 13:00Z after the change, 14:00Z before.
    expect(nextDailyRun(new Date("2026-03-07T12:00:00Z"), "America/New_York", "09:00").toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(nextDailyRun(new Date("2026-03-07T15:00:00Z"), "America/New_York", "09:00").toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
});

suite("features against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  const features = createFeaturesService(db);
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat: createChatService(db) }, features: { access, features }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => { await cleanupTestUsers(db, ids); });
  const newBot = async (as: string, name = "Helper", ready = true) => { const b = (await call(as, "POST", "/api/bots", { name })).json.bot as { id: string; version: number }; if (ready) await db.$client.query("update bot set onboarded = true where id = $1", [b.id]); return b; };
  const chat = async (as: string, botId: string, content: string) => {
    const c = (await call(as, "POST", "/api/conversations", { botId })).json.conversation.id as string;
    const r = await call(as, "POST", `/api/conversations/${c}/messages`, { content });
    return { c, reply: r.json.assistant?.content as string, status: r.status, r };
  };

  test("memory persists per user and never leaks through a shared bot", async () => {
    const bot = await newBot(A);
    await chat(A, bot.id, "remember that my favourite colour is teal");
    expect((await chat(A, bot.id, "what colour?")).reply).toContain("favourite colour is teal");
    expect((await chat(B, bot.id, "what colour?")).reply).not.toContain("teal");
    expect((await call(B, "GET", "/api/memories")).json.memories).toHaveLength(0);
  });

  test("instructions are retrieved for similar work only", async () => {
    const bot = await newBot(A);
    await call(A, "POST", "/api/instructions", { title: "Weekly newsletter digest", body: "Always list five links." });
    expect((await chat(A, bot.id, "write the newsletter please")).reply).toContain("Always list five links.");
    expect((await chat(A, bot.id, "tell me a joke")).reply).not.toContain("Always list five links.");
  });

  test("hooks add context, redact, and stop; only the bot owner configures them", async () => {
    const bot = await newBot(A);
    const add = (b: object) => call(A, "POST", `/api/bots/${bot.id}/hooks`, b);
    await add({ kind: "add_context", value: "CTX-MARK" });
    await add({ kind: "redact", pattern: "\\d{4}-\\d{4}", value: "[card]" });
    const r = await chat(A, bot.id, "my card 1234-5678 ok");
    expect(r.reply).toContain("CTX-MARK"); expect(r.reply).toContain("[card]"); expect(r.reply).not.toContain("1234-5678");
    await add({ kind: "stop", pattern: "forbidden", value: "Stopped by policy." });
    expect((await chat(A, bot.id, "this is forbidden")).reply).toBe("Stopped by policy.");
    expect((await call(B, "POST", `/api/bots/${bot.id}/hooks`, { kind: "stop", pattern: "x" })).status).toBe(404);
  });

  test("routines need a ready bot, run when due, and failures reach attention", async () => {
    const bot = await newBot(A, "Briefer", false);
    const created = await call(A, "POST", "/api/routines", { botId: bot.id, title: "Morning brief", prompt: "brief me", timezone: "America/Sao_Paulo", everyMinutes: 5 });
    expect(created.status).toBe(201);
    const rid = created.json.routine.id as string;
    expect((await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false })).status).toBe(409); // not onboarded
    const c = await chat(A, bot.id, "hello");
    expect((await call(A, "POST", `/api/bots/${bot.id}/onboarding/question`, { conversationId: c.c })).status).toBe(409); // fixture is not onboarding evidence
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]); // stands in for a real harness onboarding
    const on = await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
    expect(on.status).toBe(200); expect(on.json.routine.nextRunAt).toBeTruthy();
    expect(await features.runDue(new Date())).toBe(0);
    expect(await features.runDue(new Date(Date.now() + 6 * 60_000))).toBe(1);
    const runs = (await call(A, "GET", `/api/routines/${rid}/runs`)).json.runs;
    expect(runs).toHaveLength(1); expect(runs[0].status).toBe("succeeded");
    expect((await call(B, "GET", `/api/routines/${rid}/runs`)).json.runs).toHaveLength(0);
    // Reconfiguring the bot makes it unready; the next due occurrence pauses and raises attention instead of running.
    await call(A, "PATCH", `/api/bots/${bot.id}`, { expectedVersion: 1, patch: { personality: "new" } });
    expect(await features.runDue(new Date(Date.now() + 20 * 60_000))).toBe(1);
    const runsAfter = (await call(A, "GET", `/api/routines/${rid}/runs`)).json.runs as { status: string; reasonCode: string }[];
    expect(runsAfter).toHaveLength(2); expect(runsAfter[0]).toMatchObject({ status: "blocked", reasonCode: "not_ready" }); // the unready occurrence is recorded, not silently skipped
    const items = (await call(A, "GET", "/api/attention")).json.items as { title: string; status: string; id: string }[];
    const paused = items.find((i) => i.title.includes("paused"))!;
    expect(paused).toBeTruthy();
    expect((await call(B, "POST", `/api/attention/${paused.id}/status`, { status: "resolved" })).status).toBe(404);
    expect((await call(A, "POST", `/api/attention/${paused.id}/status`, { status: "acknowledged" })).json.item.status).toBe("acknowledged");
  });

  test("workflows branch on conditions, record a trace and reject invalid graphs", async () => {
    const bot = await newBot(A, "Flow");
    const graph = { start: "a", nodes: {
      a: { type: "prompt", botId: bot.id, template: "step one {{input}}", next: "c" },
      c: { type: "condition", contains: "step one", then: "b", else: "z" },
      b: { type: "prompt", botId: bot.id, template: "second {{prev}}", next: "z" },
      z: { type: "end" } } };
    const wf = await call(A, "POST", "/api/workflows", { name: "demo", graph });
    expect(wf.status).toBe(201);
    const run = await call(A, "POST", `/api/workflows/${wf.json.workflow.id}/run`, { input: "go" });
    expect(run.json.run.status).toBe("succeeded");
    expect(run.json.run.trace.map((t: { node: string }) => t.node)).toEqual(["a", "c", "b", "z"]);
    expect((await call(A, "POST", "/api/workflows", { name: "bad", graph: { start: "a", nodes: { a: { type: "prompt", botId: bot.id, template: "x", next: "nope" } } } })).status).toBe(400);
    expect((await call(B, "POST", `/api/workflows/${wf.json.workflow.id}/run`, { input: "go" })).status).toBe(404);
    const loop = await call(A, "POST", "/api/workflows", { name: "loop", graph: { start: "a", nodes: { a: { type: "prompt", botId: bot.id, template: "x", next: "a" }, e: { type: "end" } } } });
    expect(loop.status).toBe(400); expect(loop.json.error.message).toContain("loops"); // cycles and unreachable steps are rejected at save time
  });

  test("snapshots are immutable team copies; threads and reactions are owner-scoped", async () => {
    const bot = await newBot(A);
    const c = await chat(A, bot.id, "first");
    const pv = (await call(A, "POST", "/api/snapshots/preview", { conversationId: c.c })).json.preview;
    const snap = await call(A, "POST", "/api/snapshots", { conversationId: c.c, previewHash: pv.previewHash });
    expect(snap.status).toBe(201);
    await call(A, "POST", `/api/conversations/${c.c}/messages`, { content: "later private message" });
    const read = await call(B, "GET", `/api/snapshots/${snap.json.snapshot.id}`);
    expect(read.json.snapshot.content).toHaveLength(2);
    expect(JSON.stringify(read.json)).not.toContain("later private");
    expect((await call(B, "POST", "/api/snapshots", { conversationId: c.c, previewHash: pv.previewHash })).status).toBe(404);
    const msgs = (await call(A, "GET", `/api/conversations/${c.c}/messages`)).json.messages as { id: string }[];
    const thread = await call(A, "POST", `/api/conversations/${c.c}/messages`, { content: "in thread", parentMessageId: msgs[0]!.id });
    expect(thread.json.user.parentMessageId).toBe(msgs[0]!.id);
    expect((await call(A, "POST", `/api/conversations/${c.c}/messages`, { content: "x", parentMessageId: uuidv7() })).status).toBe(404);
    expect((await call(A, "POST", `/api/messages/${msgs[0]!.id}/reactions`, { emoji: "👍" })).json.reactions).toHaveLength(1);
    expect((await call(B, "POST", `/api/messages/${msgs[0]!.id}/reactions`, { emoji: "👍" })).status).toBe(404);
  });
});

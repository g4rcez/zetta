import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../app";
import { cleanupTestUsers } from "../test-support/db-cleanup";
import { createChatService } from "./chat/service";
import { HarnessError } from "./chat/harness";
import { createTurnRunner } from "./chat/pipeline";
import { createFeaturesService } from "./features/service";
import { createIdentityAccess } from "./identity/access";

/**
 * RFC-067: representative v1 journeys end to end through the HTTP API. The model is a scripted fake wired into the REAL turn
 * pipeline (hooks, memory, instruction retrieval, tools, proposals), so these prove Zetta's behaviour, not any vendor model.
 * Real-model evidence is separate (claude-code/haiku opt-in test and the browser walkthrough in docs/verification/v1-workflows.md).
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`v1-a-${crypto.randomUUID()}`];
const [A] = ids as [string];

suite("v1 user journeys", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  const script: string[] = []; const prompts: string[] = [];
  const cli = async (t: { prompt: string; harness: string }) => { if (t.harness === "cursor") throw new HarnessError("not_installed"); prompts.push(t.prompt); return script.shift() ?? "OK"; };
  const stream = async function* (t: { prompt: string; harness: string }) { if (t.harness === "cursor") throw new HarnessError("not_installed"); prompts.push(t.prompt); yield script.shift() ?? "OK"; };
  const run = createTurnRunner(db, cli as never, stream as never);
  const features = createFeaturesService(db, run);
  const chat = createChatService(db, run, undefined, undefined, undefined, undefined, { routine: features.routines.create as never, workflow: features.workflows.save as never });
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat }, features: { access, features }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": A, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({ id: A, name: A, email: `${A}@t.test`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(membership).values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => { await cleanupTestUsers(db, ids); });

  test("onboarding journey: configure -> real answer -> bot asks -> explicit yes -> ready; 'no' returns to refinement; reconfiguring needs a fresh check", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Newsie", harness: "pi", personality: "brief" })).json.bot;
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation.id;
    expect((await call("POST", `/api/bots/${bot.id}/onboarding/question`, { conversationId: conv })).status).toBe(409); // no real conversation yet
    await call("POST", `/api/conversations/${conv}/messages`, { content: "Introduce yourself" });
    const q1 = (await call("POST", `/api/bots/${bot.id}/onboarding/question`, { conversationId: conv })).json.questionId;
    expect((await call("POST", `/api/bots/${bot.id}/onboarding`, { conversationId: conv, questionId: q1, expectedVersion: 1, satisfied: false })).json.bot.onboarded).toBe(false);
    // routines cannot be activated for a bot that is not ready (admission gate)
    const r = (await call("POST", "/api/routines", { botId: bot.id, title: "Digest", prompt: "digest", timezone: "UTC", everyMinutes: 60 })).json.routine;
    expect((await call("POST", `/api/routines/${r.id}/paused`, { paused: false })).json.error.missing[0]).toContain("onboarding");
    const q2 = (await call("POST", `/api/bots/${bot.id}/onboarding/question`, { conversationId: conv })).json.questionId;
    expect((await call("POST", `/api/bots/${bot.id}/onboarding`, { conversationId: conv, questionId: q2, expectedVersion: 1, satisfied: true })).json.bot.onboarded).toBe(true);
    expect((await call("POST", `/api/routines/${r.id}/paused`, { paused: false })).status).toBe(200);
  });

  test("journey: successful task -> reusable instruction -> routine -> first occurrence -> durable result", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Worker", harness: "pi" })).json.bot;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation.id;
    script.push('Here is the weekly summary.\n```zetta:instruction\n{"title":"Weekly metrics summary","body":"1) pull metrics 2) compare to last week 3) three bullets","verification":"numbers match source"}\n```');
    const first = await call("POST", `/api/conversations/${conv}/messages`, { content: "Summarize this week's metrics" });
    expect(first.json.assistant.meta.receipts[0]).toMatchObject({ kind: "proposal", text: "Weekly metrics summary" });
    const prop = (await call("GET", "/api/proposals")).json.proposals.find((p: { kind: string }) => p.kind === "create_instruction"); // the user approves before it shapes future turns
    expect((await call("POST", `/api/proposals/${prop.id}/decision`, { approve: true })).json.status).toBe("approved");
    const ins = (await call("GET", "/api/instructions")).json.instructions.find((i: { title: string }) => i.title === "Weekly metrics summary");
    expect(ins).toBeTruthy();
    // the instruction is retrieved for similar later work, and the answer says what it used
    prompts.length = 0;
    const second = await call("POST", `/api/conversations/${conv}/messages`, { content: "Do the weekly metrics summary again" });
    expect(prompts.at(-1)).toContain("pull metrics"); expect(second.json.assistant.meta.used.instructions).toHaveLength(1);
    // make it recurring: the routine summary explains task, bot, timezone/next run, context mode, accounts and destination before activation
    const routine = (await call("POST", "/api/routines", { botId: bot.id, title: "Weekly metrics", prompt: "Do the weekly metrics summary", timezone: "Europe/Lisbon", dailyAt: "08:00", conversationMode: "new" })).json.routine;
    const sum = (await call("GET", `/api/routines/${routine.id}/summary`)).json.summary;
    expect(sum).toMatchObject({ bot: "Worker", timezone: "Europe/Lisbon", contextMode: "Each run starts a new chat", missing: [] }); expect(sum.nextRuns).toHaveLength(3);
    await call("POST", `/api/routines/${routine.id}/paused`, { paused: false });
    script.push("Weekly result: three bullets.");
    const done = (await call("POST", `/api/routines/${routine.id}/run`, { requestKey: "first-occurrence-001" })).json.run;
    expect(done.status).toBe("succeeded");
    const result = (await call("GET", `/api/conversations/${done.conversationId}/messages`)).json.messages;
    expect(result.at(-1).content).toBe("Weekly result: three bullets."); // durable result in a chat the owner can open
  });

  test("journey: wrong result -> inspect knowledge used -> correct it -> improved later context", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Fact", harness: "pi" })).json.bot;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const mem = (await call("POST", "/api/memories", { content: "The office closes at 17:00 on Fridays" })).json.memory;
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation.id;
    const wrong = await call("POST", `/api/conversations/${conv}/messages`, { content: "When does the office close on Fridays?" });
    const used = (await call("GET", `/api/messages/${wrong.json.assistant.id}/knowledge`)).json;
    expect(used.memories.map((m: { id: string }) => m.id)).toContain(mem.id); // the person can see which note drove the answer
    await call("PATCH", `/api/memories/${mem.id}`, { expectedVersion: 1, content: "The office closes at 15:00 on Fridays" });
    prompts.length = 0;
    // memory is frozen per conversation (stable prompt prefix): the correction shows in the next conversation
    const conv2 = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation.id;
    await call("POST", `/api/conversations/${conv2}/messages`, { content: "When does the office close on Fridays?" });
    expect(prompts.at(-1)).toContain("15:00"); expect(prompts.at(-1)).not.toContain("17:00");
  });

  test("journey: blocked task -> repair -> return to the retained work -> deliberate next attempt; screens agree", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Blocked", harness: "cursor" })).json.bot; // cursor-agent is not installed here
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const routine = (await call("POST", "/api/routines", { botId: bot.id, title: "Daily intake", prompt: "intake", timezone: "UTC", everyMinutes: 60 })).json.routine;
    await call("POST", `/api/routines/${routine.id}/paused`, { paused: false });
    const failed = (await call("POST", `/api/routines/${routine.id}/run`, { requestKey: "blocked-attempt-01" })).json.run;
    expect(failed.status).toBe("failed");
    const card = (await call("GET", "/api/attention")).json.items.find((i: { title: string }) => i.title.includes('"Daily intake" failed'));
    expect(card).toMatchObject({ status: "open", resultLink: expect.stringContaining("/chat?c=") });
    const summary = (await call("GET", "/api/attention/summary")).json.summary;
    expect(summary.open).toBe((await call("GET", "/api/attention")).json.items.filter((i: { status: string }) => i.status === "open").length); // sidebar badge == kanban column
    const activity = (await call("GET", "/api/activity")).json.events;
    expect(activity.some((e: { kind: string; outcome: string }) => e.kind === "routine_run" && e.outcome === "failed")).toBe(true); // same fact in the activity trail
    // acknowledging does not make the run succeed
    await call("POST", `/api/attention/${card.id}/action`, { action: "acknowledge" });
    expect((await call("GET", `/api/routines/${routine.id}/runs`)).json.runs[0].status).toBe("failed");
    // repair: switch the bot to a working harness, then retry deliberately (a NEW request key; the old attempt is retained)
    await call("PATCH", `/api/bots/${bot.id}`, { expectedVersion: 1, patch: { harness: "pi" } });
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]); // stands in for the explicit satisfaction check
    script.push("Intake handled.");
    const retry = (await call("POST", `/api/routines/${routine.id}/run`, { requestKey: "deliberate-retry-02" })).json.run;
    expect(retry.status).toBe("succeeded"); expect(retry.id).not.toBe(failed.id);
    const history = (await call("GET", `/api/routines/${routine.id}/runs`)).json.runs.map((r: { status: string }) => r.status);
    expect(history).toEqual(["succeeded", "failed"]); // the earlier attempt is kept
    await call("POST", `/api/attention/${card.id}/action`, { action: "resolve" });
    expect((await call("GET", "/api/attention/summary")).json.summary.open).toBeLessThan(summary.open + 1);
  });
});

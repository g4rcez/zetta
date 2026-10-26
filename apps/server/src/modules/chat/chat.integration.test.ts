import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createChatService } from "./service";
const fakeRun = Object.assign(async (t: { prompt: string }) => ({ text: `reply: ${t.prompt.slice(-40)}`, stopped: false }), { stream: async function* (t: { prompt: string }) { yield `reply: ${t.prompt.slice(-40)}`; } });

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`chat-a-${crypto.randomUUID()}`, `chat-b-${crypto.randomUUID()}`];

suite("chat against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat: createChatService(db, fakeRun as never) }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = (as: string, method: string, path: string, body?: unknown) => app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => { await cleanupTestUsers(db, ids); });
  test("team specialists are visible but only editable by the owner", async () => {
    const created = await (await call(ids[0]!, "POST", "/api/bots", { name: "Reviewer" })).json() as { bot: { id: string; version: number } };
    const list = await (await call(ids[1]!, "GET", "/api/bots")).json() as { bots: { id: string; canEdit: boolean }[] };
    expect(list.bots.find((b) => b.id === created.bot.id)?.canEdit).toBe(false);
    expect((await call(ids[1]!, "PATCH", `/api/bots/${created.bot.id}`, { expectedVersion: 1, patch: { name: "x" } })).status).toBe(404);
    expect((await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, { expectedVersion: 1, patch: { name: "Reviewer 2" } })).status).toBe(200);
    expect((await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, { expectedVersion: 1, patch: { name: "stale" } })).status).toBe(404);
  });
  test("team specialists are visible but only editable by the owner", async () => {
    const created = await (await call(ids[0]!, "POST", "/api/bots", { name: "Reviewer" })).json() as { bot: { id: string; version: number } };
    const list = await (await call(ids[1]!, "GET", "/api/bots")).json() as { bots: { id: string; canEdit: boolean }[] };
    expect(list.bots.find((b) => b.id === created.bot.id)?.canEdit).toBe(false);
    expect((await call(ids[1]!, "PATCH", `/api/bots/${created.bot.id}`, { expectedVersion: 1, patch: { name: "x" } })).status).toBe(404);
    expect((await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, { expectedVersion: 1, patch: { name: "Reviewer 2" } })).status).toBe(200);
    expect((await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, { expectedVersion: 1, patch: { name: "stale" } })).status).toBe(404);
  });
  test("workspaces only group bots and never change access", async () => {
    const w = (await (await call(ids[0]!, "POST", "/api/workspaces", { name: "Research" })).json() as { workspace: { id: string } }).workspace;
    const chiefBots = (await (await call(ids[0]!, "GET", "/api/bots")).json() as { bots: { id: string; kind: string }[] }).bots;
    const chief = chiefBots.find((b) => b.kind === "chief")!;
    expect((await call(ids[0]!, "POST", `/api/bots/${chief.id}/workspace`, { workspaceId: w.id })).status).toBe(200);
    expect((await call(ids[1]!, "POST", `/api/bots/${chief.id}/workspace`, { workspaceId: null })).status).toBe(404);
    expect((await call(ids[1]!, "POST", `/api/bots/${chief.id}/workspace`, { workspaceId: w.id })).status).toBe(404);
    const after = (await (await call(ids[0]!, "GET", "/api/bots")).json() as { bots: { kind: string }[] }).bots;
    expect(after.filter((b) => b.kind === "chief")).toHaveLength(1);
    expect((await (await call(ids[1]!, "GET", "/api/workspaces")).json() as { workspaces: unknown[] }).workspaces).toHaveLength(0);
    // inner groups: parent must be the caller's own workspace
    const inner = await call(ids[0]!, "POST", "/api/workspaces", { name: "Papers", parentId: w.id });
    expect(inner.status).toBe(201);
    expect((await (await call(ids[0]!, "GET", "/api/workspaces")).json() as { workspaces: { parentId: string | null; name: string }[] }).workspaces.find((x) => x.name === "Papers")?.parentId).toBe(w.id);
    expect((await call(ids[1]!, "POST", "/api/workspaces", { name: "Sneaky", parentId: w.id })).status).toBe(404);
  });
  test("a bot owned by someone else is unusable until its owner finishes onboarding it", async () => {
    const { bot: b } = await (await call(ids[0]!, "POST", "/api/bots", { name: "Shared one", harness: "pi" })).json() as { bot: { id: string } };
    const conv = (await (await call(ids[1]!, "POST", "/api/conversations", { botId: b.id })).json() as { conversation: { id: string } }).conversation;
    expect((await call(ids[1]!, "POST", `/api/conversations/${conv.id}/messages`, { content: "hi" })).status).toBe(409);
  });
  test("onboarding: persisted question, explicit answer tied to it, one answer, reset on reconfiguration", async () => {
    const { bot: b } = await (await call(ids[0]!, "POST", "/api/bots", { name: "Onboard me", harness: "pi" })).json() as { bot: { id: string; version: number } };
    const conv = (await (await call(ids[0]!, "POST", "/api/conversations", { botId: b.id })).json() as { conversation: { id: string } }).conversation;
    const ask = (as: string) => call(as, "POST", `/api/bots/${b.id}/onboarding/question`, { conversationId: conv.id });
    const answer = (as: string, questionId: string, satisfied: boolean, version = b.version) => call(as, "POST", `/api/bots/${b.id}/onboarding`, { conversationId: conv.id, questionId, expectedVersion: version, satisfied });
    expect((await ask(ids[0]!)).status).toBe(409); // no real conversation yet
    await call(ids[0]!, "POST", `/api/conversations/${conv.id}/messages`, { content: "ping" });
    expect((await ask(ids[1]!)).status).toBe(404); // not the owner
    const q = await (await ask(ids[0]!)).json() as { questionId: string };
    expect((await answer(ids[1]!, q.questionId, true)).status).toBe(404);
    expect((await answer(ids[0]!, crypto.randomUUID(), true)).status).toBe(409); // an answer must reference the persisted question
    const no = await (await answer(ids[0]!, q.questionId, false)).json() as { bot: { onboarded: boolean } };
    expect(no.bot.onboarded).toBe(false);
    expect((await answer(ids[0]!, q.questionId, true)).status).toBe(404); // the question was already answered
    const q2 = await (await ask(ids[0]!)).json() as { questionId: string };
    expect(((await (await answer(ids[0]!, q2.questionId, true)).json()) as { bot: { onboarded: boolean } }).bot.onboarded).toBe(true);
    const msgs = (await (await call(ids[0]!, "GET", `/api/conversations/${conv.id}/messages`)).json() as { messages: { role: string; content: string }[] }).messages;
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(2);
    expect(msgs.some((m) => m.content === "Yes, I am satisfied.")).toBe(true);
    const edited = await (await call(ids[0]!, "PATCH", `/api/bots/${b.id}`, { expectedVersion: b.version, patch: { personality: "terse" } })).json() as { bot: { onboarded: boolean; version: number } };
    expect(edited.bot.onboarded).toBe(false);
    expect((await answer(ids[0]!, q2.questionId, true, edited.bot.version)).status).toBe(409); // old-version evidence is not enough
  });
  test("the chief without a real harness guides setup; messages paginate with reply counts", async () => {
    const chief = ((await (await call(ids[0]!, "GET", "/api/bots")).json()) as { bots: { id: string; kind: string }[] }).bots.find((b) => b.kind === "chief")!;
    const conv = (await (await call(ids[0]!, "POST", "/api/conversations", { botId: chief.id })).json() as { conversation: { id: string } }).conversation;
    const r = await (await call(ids[0]!, "POST", `/api/conversations/${conv.id}/messages`, { content: "hello chief" })).json() as { assistant: { content: string }; user: { id: string } };
    expect(r.assistant.content).toContain("not connected to an AI tool yet");
    for (let i = 0; i < 5; i++) await call(ids[0]!, "POST", `/api/conversations/${conv.id}/messages`, { content: `m${i}`, parentMessageId: r.user.id });
    const page = (await (await call(ids[0]!, "GET", `/api/conversations/${conv.id}/messages?limit=4`)).json() as { messages: { seq: number; replyCount: number; hasMore: boolean }[] }).messages;
    expect(page).toHaveLength(4); expect(page[0]!.hasMore).toBe(true);
    const older = (await (await call(ids[0]!, "GET", `/api/conversations/${conv.id}/messages?limit=100&before=${page[0]!.seq}`)).json() as { messages: { seq: number; replyCount: number }[] }).messages;
    expect(older.every((m) => m.seq < page[0]!.seq)).toBe(true);
    const root = (await (await call(ids[0]!, "GET", `/api/conversations/${conv.id}/messages?limit=500`)).json() as { messages: { id: string; replyCount: number }[] }).messages.find((m) => m.id === r.user.id)!;
    expect(root.replyCount).toBeGreaterThanOrEqual(5);
  });
  test("workspaces can be renamed and deleted without touching bots, chats or access", async () => {
    const w = (await (await call(ids[0]!, "POST", "/api/workspaces", { name: "Temp" })).json() as { workspace: { id: string } }).workspace;
    const inner = (await (await call(ids[0]!, "POST", "/api/workspaces", { name: "TempInner", parentId: w.id })).json() as { workspace: { id: string } }).workspace;
    const b = (await (await call(ids[0]!, "POST", "/api/bots", { name: "InTemp" })).json() as { bot: { id: string } }).bot;
    await call(ids[0]!, "POST", `/api/bots/${b.id}/workspace`, { workspaceId: w.id });
    expect((await call(ids[1]!, "PATCH", `/api/workspaces/${w.id}`, { name: "Hack" })).status).toBe(404);
    expect((await call(ids[0]!, "PATCH", `/api/workspaces/${w.id}`, { name: "Renamed" })).status).toBe(200);
    expect((await call(ids[1]!, "DELETE", `/api/workspaces/${w.id}`)).status).toBe(404);
    expect((await call(ids[0]!, "DELETE", `/api/workspaces/${w.id}`)).status).toBe(200);
    const bots = (await (await call(ids[0]!, "GET", "/api/bots")).json() as { bots: { id: string; workspaceId: string | null }[] }).bots;
    expect(bots.find((x) => x.id === b.id)!.workspaceId).toBeNull(); // moved up, still there
    const spaces = (await (await call(ids[0]!, "GET", "/api/workspaces")).json() as { workspaces: { id: string; parentId: string | null }[] }).workspaces;
    expect(spaces.find((x) => x.id === inner.id)!.parentId).toBeNull(); expect(spaces.some((x) => x.id === w.id)).toBe(false);
  });
});
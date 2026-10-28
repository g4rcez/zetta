import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { agendaItem, agendaSync } from "@zetta/db/schema/agenda";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess, type ActiveActor } from "../identity/access";
import { configureGoogleForTests } from "../integrations/plugins/google/oauth";
import type { PluginContext } from "../integrations/plugins/registry";
import { createGoogleAgendaSync } from "./google-sync";
import { createAgendaScheduler } from "./scheduler";
import { createAgenda } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`agenda-a-${uuidv7()}`, `agenda-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const actor = (userId: string): ActiveActor => ({ userId, isAdmin: false });

/** A fake Google Calendar: events by id, incremental sync tokens, etags, and switches for 410/412. */
type GEv = { id: string; etag: string; status?: string; summary?: string; start: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };
const google = { events: new Map<string, GEv>(), changed: new Set<string>(), gone: false, conflictOnce: false, seq: 0, requests: [] as { method: string; path: string; query: string; ifMatch: string | null }[] };
const fake = Bun.serve({ port: 0, async fetch(req) {
  const u = new URL(req.url); const json = (o: unknown, status = 200) => Response.json(o, { status });
  google.requests.push({ method: req.method, path: u.pathname, query: u.search, ifMatch: req.headers.get("if-match") });
  const m = u.pathname.match(/^\/cal\/calendars\/primary\/events(?:\/(.+))?$/);
  if (!m) return json({}, 404);
  const id = m[1] ? decodeURIComponent(m[1]) : undefined;
  if (req.method === "GET") {
    const token = u.searchParams.get("syncToken");
    if (token && google.gone) { google.gone = false; return json({ error: { code: 410 } }, 410); }
    const items = token ? [...google.changed].map((k) => google.events.get(k)!) : [...google.events.values()].filter((e) => e.status !== "cancelled");
    google.changed.clear();
    return json({ items, nextSyncToken: `tok-${++google.seq}` });
  }
  if (req.method === "POST") {
    const b = await req.json() as Omit<GEv, "id" | "etag">; const e = { ...b, id: `g${++google.seq}`, etag: `"e${google.seq}"` };
    google.events.set(e.id, e); return json(e);
  }
  const cur = id ? google.events.get(id) : undefined;
  if (!cur) return json({}, 404);
  if (req.method === "PATCH") {
    if (google.conflictOnce && req.headers.get("if-match")) { google.conflictOnce = false; return json({}, 412); }
    const e = { ...cur, ...(await req.json() as object), etag: `"e${++google.seq}"` }; google.events.set(cur.id, e); return json(e);
  }
  if (req.method === "DELETE") { google.events.set(cur.id, { ...cur, status: "cancelled" }); return new Response(null, { status: 204 }); }
  return json({}, 405);
} });
afterAll(() => { fake.stop(true); configureGoogleForTests({}); });

const gctx = (userId: string, scopes = "calendar.events"): PluginContext => {
  let config: Record<string, string> = { clientId: "c", clientSecret: "s", refreshToken: "r", accessToken: "a", expiresAt: String(Date.now() + 3_600_000), scopes };
  return { userId, get config() { return config; }, async setConfig(n) { config = { ...n }; } };
};

suite("Agenda against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const agenda = createAgenda(db);
  const sync = createGoogleAgendaSync(db);
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => { await cleanupTestUsers(db, ids); });
  beforeEach(() => {
    configureGoogleForTests({ calendarBase: `http://localhost:${fake.port}/cal` });
    google.events.clear(); google.changed.clear(); google.gone = false; google.conflictOnce = false; google.requests = [];
  });

  test("items are private to their owner, versioned, and listed by overlapping range", async () => {
    const t = await agenda.create(actor(A), { kind: "task", title: "File taxes", startAt: new Date("2026-11-02T12:00:00Z") });
    expect(t.remindAt?.toISOString()).toBe("2026-11-02T12:00:00.000Z"); // tasks remind at their start
    const ev = await agenda.create(actor(A), { kind: "event", title: "Trip", startAt: new Date("2026-10-30T00:00:00Z"), endAt: new Date("2026-11-05T00:00:00Z"), allDay: true });
    expect(ev.remindAt).toBeNull();
    const inRange = await agenda.list(actor(A), new Date("2026-11-01T00:00:00Z"), new Date("2026-11-03T00:00:00Z"));
    expect(inRange.map((i) => i.title).sort()).toEqual(["File taxes", "Trip"]); // the trip started before but is still running
    expect(await agenda.list(actor(B), new Date("2026-11-01T00:00:00Z"), new Date("2026-11-03T00:00:00Z"))).toHaveLength(0);
    await expect(agenda.get(actor(B), t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(agenda.update(actor(B), t.id, 1, { title: "mine" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const moved = await agenda.update(actor(A), t.id, 1, { startAt: new Date("2026-11-03T12:00:00Z") });
    expect(moved.version).toBe(2); expect(moved.remindAt?.toISOString()).toBe("2026-11-03T12:00:00.000Z"); // the reminder follows the start
    await expect(agenda.update(actor(A), t.id, 1, { title: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(agenda.create(actor(A), { kind: "event", title: "Bad", startAt: new Date("2026-11-03T12:00:00Z"), endAt: new Date("2026-11-03T11:00:00Z") })).rejects.toMatchObject({ code: "INVALID" });
    const removed = await agenda.remove(actor(A), ev.id);
    expect(removed.archived).toBe(true); expect(removed.syncState).toBe("local"); // never on Google: nothing to delete there
  });

  test("due reminders raise one attention item each, exactly once", async () => {
    const now = new Date();
    const r = await agenda.create(actor(B), { kind: "reminder", title: "Stretch", startAt: new Date(now.getTime() - 60_000) });
    const later = await agenda.create(actor(B), { kind: "reminder", title: "Later", startAt: new Date(now.getTime() + 3_600_000) });
    const scheduler = createAgendaScheduler(db, undefined, async () => ({ isAdmin: false }));
    await scheduler.tick(now); await scheduler.tick(now);
    const cards = await db.select().from(attentionItem).where(and(eq(attentionItem.ownerUserId, B), eq(attentionItem.sourceKey, `agenda:${r.id}`)));
    expect(cards).toHaveLength(1); expect(cards[0]!.title).toBe("Reminder: Stretch"); expect(cards[0]!.resultLink).toBe(`/agenda?item=${r.id}`);
    expect((await agenda.get(actor(B), later.id)).remindedAt).toBeNull();
  });

  test("two-way Google sync: pull, push with etag, conflicts, deletes and an expired sync token", async () => {
    await agenda.setSyncSettings(actor(A), { enabled: true, pushByDefault: false });
    const ctx = gctx(A);
    google.events.set("ev1", { id: "ev1", etag: '"1"', summary: "Standup", start: { dateTime: "2026-10-28T12:00:00Z" }, end: { dateTime: "2026-10-28T12:15:00Z" } });
    await sync.run(ctx, A);
    const [pulled] = await db.select().from(agendaItem).where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.googleEventId, "ev1")));
    expect(pulled).toMatchObject({ title: "Standup", source: "google", syncState: "synced", kind: "event" });
    expect(google.requests.find((r) => r.method === "GET")!.query).toContain("timeMin"); // first run: bounded full window

    // Local edit goes out with If-Match; Google's newer copy (412) does not block the user's change.
    google.conflictOnce = true;
    const edited = await agenda.update(actor(A), pulled!.id, pulled!.version, { title: "Standup (moved)" });
    expect(edited.syncState).toBe("pending_push");
    await sync.run(ctx, A);
    expect(google.events.get("ev1")!.summary).toBe("Standup (moved)");
    expect(google.requests.filter((r) => r.method === "PATCH").map((r) => r.ifMatch)).toEqual(['"1"', null]);
    expect((await agenda.get(actor(A), pulled!.id)).syncState).toBe("synced");

    // A new item sent to Google gets its event id; deleting it deletes it there.
    const mine = await agenda.create(actor(A), { kind: "task", title: "Pay rent", startAt: new Date("2026-11-01T12:00:00Z"), syncToGoogle: true });
    expect(mine.syncState).toBe("pending_push");
    await sync.run(ctx, A);
    const pushed = await agenda.get(actor(A), mine.id);
    expect(pushed.googleEventId).toBeTruthy(); expect(google.events.get(pushed.googleEventId!)!.summary).toBe("Pay rent");
    await agenda.remove(actor(A), mine.id);
    await sync.run(ctx, A);
    expect(google.events.get(pushed.googleEventId!)!.status).toBe("cancelled");

    // Incremental pull: a change and a cancellation on Google.
    google.events.set("ev1", { ...google.events.get("ev1")!, summary: "Standup v2", etag: '"9"' }); google.changed.add("ev1");
    google.events.set("ev2", { id: "ev2", etag: '"2"', summary: "Lunch", start: { dateTime: "2026-10-29T15:00:00Z" } }); google.changed.add("ev2");
    await sync.run(ctx, A);
    expect(google.requests.filter((r) => r.method === "GET").at(-1)!.query).toContain("syncToken");
    expect((await agenda.get(actor(A), pulled!.id)).title).toBe("Standup v2");
    google.events.set("ev2", { ...google.events.get("ev2")!, status: "cancelled" }); google.changed.add("ev2");
    await sync.run(ctx, A);
    const [lunch] = await db.select().from(agendaItem).where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.googleEventId, "ev2")));
    expect(lunch!.archived).toBe(true);

    // An expired sync token (410) restarts with a full window instead of failing.
    google.gone = true;
    await sync.run(ctx, A);
    const gets = google.requests.filter((r) => r.method === "GET").slice(-2);
    expect(gets[0]!.query).toContain("syncToken"); expect(gets[1]!.query).toContain("timeMin");
  });

  test("read-only Google access imports but marks local pushes as errors", async () => {
    await agenda.setSyncSettings(actor(B), { enabled: true });
    const item = await agenda.create(actor(B), { kind: "event", title: "Gym", startAt: new Date("2026-11-04T10:00:00Z"), syncToGoogle: true });
    google.events.set("ro1", { id: "ro1", etag: '"1"', summary: "Team call", start: { dateTime: "2026-11-04T13:00:00Z" } });
    const r = await sync.run(gctx(B, "calendar.events.readonly"), B);
    expect(r.readOnly).toBe(true); expect(r.pulled).toBe(1);
    const after = await agenda.get(actor(B), item.id);
    expect(after.syncState).toBe("error"); expect(after.syncError).toContain("read-only");
    expect(google.requests.some((x) => x.method === "POST")).toBe(false);
  });

  test("routes and the zetta:agenda bot tool: writes apply with a receipt, reads stay allowed after outside content", async () => {
    const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
    let script: string[] = [];
    const fakeRun = Object.assign(async () => ({ text: script.shift() ?? "done", stopped: false }), { stream: async function* () { yield script.shift() ?? "done"; } });
    const chat = createChatService(db, fakeRun as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, agenda);
    const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat } as never,
      agenda: { access, agenda, scheduler: createAgendaScheduler(db, undefined, async () => ({ isAdmin: false })) }, webOrigin: "http://web.test", desktopOrigins: [] });
    const call = async (as: string, method: string, path: string, body?: unknown) => {
      const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
      return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
    };
    const created = await call(A, "POST", "/api/agenda", { kind: "note", title: "Bring ID", startAt: "2026-12-01T09:00:00-03:00" });
    expect(created.status).toBe(201);
    expect((await call(B, "GET", `/api/agenda/${created.json.item.id}`)).status).toBe(404);
    expect((await call(A, "GET", "/api/agenda?from=2026-12-01T00:00:00Z&to=2026-12-02T00:00:00Z")).json.items.map((i: { title: string }) => i.title)).toContain("Bring ID");
    expect((await call(A, "POST", `/api/agenda/${created.json.item.id}/complete`, { done: true })).json.item.status).toBe("done");

    const bot = (await call(A, "POST", "/api/bots", { name: "Planner" })).json.bot as { id: string };
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot.id })).json.conversation.id as string;
    script = ['On it.\n```zetta:agenda\n{"action":"add","kind":"reminder","title":"Call Ana","start":"2026-12-02T09:00:00-03:00"}\n```'];
    const r = await call(A, "POST", `/api/conversations/${conv}/messages`, { content: "remind me to call Ana on Dec 2 at 9" });
    expect(r.json.assistant.content).toContain("Added to your Agenda"); expect(r.json.assistant.content).not.toContain("zetta:");
    const [added] = await db.select().from(agendaItem).where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.title, "Call Ana")));
    expect(added).toMatchObject({ kind: "reminder", source: "bot", createdByBotId: bot.id, conversationId: conv });
    expect(added!.startAt.toISOString()).toBe("2026-12-02T12:00:00.000Z");

    // After a tool result (outside content), a write is ignored but the list read went through.
    script = ['```zetta:agenda\n{"action":"list","from":"2026-12-01T00:00:00Z","to":"2026-12-03T00:00:00Z"}\n```', '```zetta:agenda\n{"action":"add","title":"Injected","start":"2026-12-02T10:00:00Z"}\n```'];
    const r2 = await call(A, "POST", `/api/conversations/${conv}/messages`, { content: "what is on my agenda?" });
    expect(r2.json.assistant.content).toContain("Read your Agenda");
    expect(await db.select().from(agendaItem).where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.title, "Injected")))).toHaveLength(0);
    expect((await db.select().from(agendaSync).where(eq(agendaSync.ownerUserId, A)))[0]?.enabled).toBe(true);
  });
});

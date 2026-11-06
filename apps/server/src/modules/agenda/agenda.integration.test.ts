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
const ids = ["a", "b", "c", "d", "e", "f"].map((n) => `agenda-${n}-${uuidv7()}`);
const [A, B, C, D, E, F] = ids as [string, string, string, string, string, string];
const actor = (userId: string): ActiveActor => ({ userId, isAdmin: false });

/** A fake Google Calendar: events by id, incremental sync tokens, etags, and switches for 410/412/403. One store per access token, so two accounts see different calendars. */
type GEv = {
  id: string;
  etag: string;
  status?: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};
type Req = { method: string; path: string; query: string; ifMatch: string | null };
const newStore = () => ({
  events: new Map<string, GEv>(),
  changed: new Set<string>(),
  gone: false,
  conflictOnce: false,
  deny: false,
  requests: [] as Req[],
});
const stores = { a: newStore(), b: newStore() };
const google = stores.a;
let seq = 0;
const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const json = (o: unknown, status = 200) => Response.json(o, { status });
    const s = req.headers.get("authorization") === "Bearer b" ? stores.b : stores.a;
    s.requests.push({
      method: req.method,
      path: u.pathname,
      query: u.search,
      ifMatch: req.headers.get("if-match"),
    });
    if (s.deny) return json({}, 403);
    const m = u.pathname.match(/^\/cal\/calendars\/primary\/events(?:\/(.+))?$/);
    if (!m) return json({}, 404);
    const id = m[1] ? decodeURIComponent(m[1]) : undefined;
    if (req.method === "GET") {
      const token = u.searchParams.get("syncToken");
      if (token && s.gone) {
        s.gone = false;
        return json({ error: { code: 410 } }, 410);
      }
      const items = token
        ? [...s.changed].map((k) => s.events.get(k)!)
        : [...s.events.values()].filter((e) => e.status !== "cancelled");
      s.changed.clear();
      return json({ items, nextSyncToken: `tok-${++seq}` });
    }
    if (req.method === "POST") {
      const b = (await req.json()) as Omit<GEv, "id" | "etag">;
      const e = { ...b, id: `g${++seq}`, etag: `"e${seq}"` };
      s.events.set(e.id, e);
      return json(e);
    }
    const cur = id ? s.events.get(id) : undefined;
    if (!cur) return json({}, 404);
    if (req.method === "PATCH") {
      if (s.conflictOnce && req.headers.get("if-match")) {
        s.conflictOnce = false;
        return json({}, 412);
      }
      const e = { ...cur, ...((await req.json()) as object), etag: `"e${++seq}"` };
      s.events.set(cur.id, e);
      return json(e);
    }
    if (req.method === "DELETE") {
      s.events.set(cur.id, { ...cur, status: "cancelled" });
      return new Response(null, { status: 204 });
    }
    return json({}, 405);
  },
});
afterAll(() => {
  fake.stop(true);
  configureGoogleForTests({});
});

/** The user's Google plugin context with one account in the config format from before accounts existed. */
const gctx = (userId: string, scopes = "calendar.events"): PluginContext => {
  let config: Record<string, string> = {
    clientId: "c",
    clientSecret: "s",
    refreshToken: "r",
    accessToken: "a",
    expiresAt: String(Date.now() + 3_600_000),
    scopes,
  };
  return {
    userId,
    get config() {
      return config;
    },
    async setConfig(n) {
      config = { ...n };
    },
  };
};
type Acct = { email: string; token?: "a" | "b"; scopes?: string };
/** A Google plugin context with several accounts. `token` picks the fake calendar the account sees; no token means "needs to reconnect". */
const gaccts = (userId: string, ...list: Acct[]): PluginContext => {
  const accounts = list.map((a) =>
    a.token
      ? {
          email: a.email,
          refreshToken: `r-${a.token}`,
          accessToken: a.token,
          expiresAt: String(Date.now() + 3_600_000),
          scopes: a.scopes ?? "calendar.events",
        }
      : { email: a.email },
  );
  let config: Record<string, string> = {
    clientId: "c",
    clientSecret: "s",
    accounts: JSON.stringify(accounts),
  };
  return {
    userId,
    get config() {
      return config;
    },
    async setConfig(n) {
      config = { ...n };
    },
  };
};
const ONE = "one@example.invalid",
  TWO = "two@example.invalid";

suite("Agenda against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const agenda = createAgenda(db);
  const sync = createGoogleAgendaSync(db);
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
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
    await cleanupTestUsers(db, ids);
  });
  beforeEach(() => {
    configureGoogleForTests({ calendarBase: `http://localhost:${fake.port}/cal` });
    for (const st of Object.values(stores)) Object.assign(st, newStore());
  });

  test("items are private to their owner, versioned, and listed by overlapping range", async () => {
    const t = await agenda.create(actor(A), {
      kind: "task",
      title: "File taxes",
      startAt: new Date("2026-11-02T12:00:00Z"),
    });
    expect(t.remindAt?.toISOString()).toBe("2026-11-02T12:00:00.000Z"); // tasks remind at their start
    const ev = await agenda.create(actor(A), {
      kind: "event",
      title: "Trip",
      startAt: new Date("2026-10-30T00:00:00Z"),
      endAt: new Date("2026-11-05T00:00:00Z"),
      allDay: true,
    });
    expect(ev.remindAt).toBeNull();
    const inRange = await agenda.list(
      actor(A),
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-03T00:00:00Z"),
    );
    expect(inRange.map((i) => i.title).sort()).toEqual(["File taxes", "Trip"]); // the trip started before but is still running
    expect(
      await agenda.list(
        actor(B),
        new Date("2026-11-01T00:00:00Z"),
        new Date("2026-11-03T00:00:00Z"),
      ),
    ).toHaveLength(0);
    await expect(agenda.get(actor(B), t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(agenda.update(actor(B), t.id, 1, { title: "mine" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const moved = await agenda.update(actor(A), t.id, 1, {
      startAt: new Date("2026-11-03T12:00:00Z"),
    });
    expect(moved.version).toBe(2);
    expect(moved.remindAt?.toISOString()).toBe("2026-11-03T12:00:00.000Z"); // the reminder follows the start
    await expect(agenda.update(actor(A), t.id, 1, { title: "stale" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      agenda.create(actor(A), {
        kind: "event",
        title: "Bad",
        startAt: new Date("2026-11-03T12:00:00Z"),
        endAt: new Date("2026-11-03T11:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const removed = await agenda.remove(actor(A), ev.id);
    expect(removed.archived).toBe(true);
    expect(removed.syncState).toBe("local"); // never on Google: nothing to delete there
  });

  test("due reminders raise one attention item each, exactly once", async () => {
    const now = new Date();
    const r = await agenda.create(actor(B), {
      kind: "reminder",
      title: "Stretch",
      startAt: new Date(now.getTime() - 60_000),
    });
    const later = await agenda.create(actor(B), {
      kind: "reminder",
      title: "Later",
      startAt: new Date(now.getTime() + 3_600_000),
    });
    const scheduler = createAgendaScheduler(db, undefined, async () => ({ isAdmin: false }));
    await scheduler.tick(now);
    await scheduler.tick(now);
    const cards = await db
      .select()
      .from(attentionItem)
      .where(and(eq(attentionItem.ownerUserId, B), eq(attentionItem.sourceKey, `agenda:${r.id}`)));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe("Reminder: Stretch");
    expect(cards[0]!.resultLink).toBe(`/agenda?item=${r.id}`);
    expect((await agenda.get(actor(B), later.id)).remindedAt).toBeNull();
  });

  test("two-way Google sync: pull, push with etag, conflicts, deletes and an expired sync token", async () => {
    await agenda.setSyncSettings(actor(A), { enabled: true, pushByDefault: false });
    const ctx = gctx(A);
    google.events.set("ev1", {
      id: "ev1",
      etag: '"1"',
      summary: "Standup",
      start: { dateTime: "2026-10-28T12:00:00Z" },
      end: { dateTime: "2026-10-28T12:15:00Z" },
    });
    await sync.runAll(ctx, A);
    const [pulled] = await db
      .select()
      .from(agendaItem)
      .where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.googleEventId, "ev1")));
    expect(pulled).toMatchObject({
      title: "Standup",
      source: "google",
      syncState: "synced",
      kind: "event",
    });
    expect(google.requests.find((r) => r.method === "GET")!.query).toContain("timeMin"); // first run: bounded full window

    // Local edit goes out with If-Match; Google's newer copy (412) does not block the user's change.
    google.conflictOnce = true;
    const edited = await agenda.update(actor(A), pulled!.id, pulled!.version, {
      title: "Standup (moved)",
    });
    expect(edited.syncState).toBe("pending_push");
    await sync.runAll(ctx, A);
    expect(google.events.get("ev1")!.summary).toBe("Standup (moved)");
    expect(google.requests.filter((r) => r.method === "PATCH").map((r) => r.ifMatch)).toEqual([
      '"1"',
      null,
    ]);
    expect((await agenda.get(actor(A), pulled!.id)).syncState).toBe("synced");

    // A new item sent to Google gets its event id; deleting it deletes it there.
    const mine = await agenda.create(actor(A), {
      kind: "task",
      title: "Pay rent",
      startAt: new Date("2026-11-01T12:00:00Z"),
      syncToGoogle: true,
    });
    expect(mine.syncState).toBe("pending_push");
    await sync.runAll(ctx, A);
    const pushed = await agenda.get(actor(A), mine.id);
    expect(pushed.googleEventId).toBeTruthy();
    expect(google.events.get(pushed.googleEventId!)!.summary).toBe("Pay rent");
    await agenda.remove(actor(A), mine.id);
    await sync.runAll(ctx, A);
    expect(google.events.get(pushed.googleEventId!)!.status).toBe("cancelled");

    // Incremental pull: a change and a cancellation on Google.
    google.events.set("ev1", { ...google.events.get("ev1")!, summary: "Standup v2", etag: '"9"' });
    google.changed.add("ev1");
    google.events.set("ev2", {
      id: "ev2",
      etag: '"2"',
      summary: "Lunch",
      start: { dateTime: "2026-10-29T15:00:00Z" },
    });
    google.changed.add("ev2");
    await sync.runAll(ctx, A);
    expect(google.requests.filter((r) => r.method === "GET").at(-1)!.query).toContain("syncToken");
    expect((await agenda.get(actor(A), pulled!.id)).title).toBe("Standup v2");
    google.events.set("ev2", { ...google.events.get("ev2")!, status: "cancelled" });
    google.changed.add("ev2");
    await sync.runAll(ctx, A);
    const [lunch] = await db
      .select()
      .from(agendaItem)
      .where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.googleEventId, "ev2")));
    expect(lunch!.archived).toBe(true);

    // An expired sync token (410) restarts with a full window instead of failing.
    google.gone = true;
    await sync.runAll(ctx, A);
    const gets = google.requests.filter((r) => r.method === "GET").slice(-2);
    expect(gets[0]!.query).toContain("syncToken");
    expect(gets[1]!.query).toContain("timeMin");
  });

  test("read-only Google access imports but marks local pushes as errors", async () => {
    await agenda.setSyncSettings(actor(B), { enabled: true });
    const item = await agenda.create(actor(B), {
      kind: "event",
      title: "Gym",
      startAt: new Date("2026-11-04T10:00:00Z"),
      syncToGoogle: true,
    });
    google.events.set("ro1", {
      id: "ro1",
      etag: '"1"',
      summary: "Team call",
      start: { dateTime: "2026-11-04T13:00:00Z" },
    });
    const [r] = (await sync.runAll(gctx(B, "calendar.events.readonly"), B)).results;
    if (!r?.ok) throw new Error("sync failed");
    expect(r.readOnly).toBe(true);
    expect(r.pulled).toBe(1);
    const after = await agenda.get(actor(B), item.id);
    expect(after.syncState).toBe("error");
    expect(after.syncError).toContain("read-only");
    expect(google.requests.some((x) => x.method === "POST")).toBe(false);
  });

  test("every account syncs on its own: one event id in two calendars stays two items, cursors are per account, new items go to the push account", async () => {
    await agenda.setSyncSettings(actor(C), { enabled: true });
    const ctx = gaccts(C, { email: ONE, token: "a" }, { email: TWO, token: "b" });
    const shared = (summary: string, etag = '"1"'): GEv => ({
      id: "shared1",
      etag,
      summary,
      start: { dateTime: "2026-10-28T12:00:00Z" },
    });
    stores.a.events.set("shared1", shared("Review (one)"));
    stores.b.events.set("shared1", shared("Review (two)"));
    const first = await sync.runAll(ctx, C);
    expect(first.results.map((r) => [r.email, r.ok])).toEqual([
      [ONE, true],
      [TWO, true],
    ]);
    const rows = async () =>
      (
        await db
          .select()
          .from(agendaItem)
          .where(and(eq(agendaItem.ownerUserId, C), eq(agendaItem.googleEventId, "shared1")))
      ).sort((x, y) => (x.googleAccount ?? "").localeCompare(y.googleAccount ?? ""));
    expect((await rows()).map((r) => [r.googleAccount, r.title])).toEqual([
      [ONE, "Review (one)"],
      [TWO, "Review (two)"],
    ]);

    // Second round: each account continues from its own cursor and only the changed calendar changes its item.
    stores.a.requests = [];
    stores.b.requests = [];
    stores.a.events.set("shared1", shared("Review (one) v2", '"2"'));
    stores.a.changed.add("shared1");
    await sync.runAll(ctx, C);
    for (const st of [stores.a, stores.b])
      expect(st.requests.find((r) => r.method === "GET")!.query).toContain("syncToken=tok-");
    expect((await rows()).map((r) => r.title)).toEqual(["Review (one) v2", "Review (two)"]);

    // New items go to the first account that can write, or to the one the user chose; edits go back to the account that holds the item.
    const mine = await agenda.create(actor(C), {
      kind: "task",
      title: "Pay rent",
      startAt: new Date("2026-11-01T12:00:00Z"),
      syncToGoogle: true,
    });
    await sync.runAll(ctx, C);
    expect(stores.a.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(stores.b.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    const pushed = await agenda.get(actor(C), mine.id);
    expect(pushed.googleAccount).toBe(ONE);
    expect((await agenda.setSyncSettings(actor(C), { pushAccount: TWO })).pushAccount).toBe(TWO);
    const other = await agenda.create(actor(C), {
      kind: "task",
      title: "Call bank",
      startAt: new Date("2026-11-02T12:00:00Z"),
      syncToGoogle: true,
    });
    await agenda.update(actor(C), mine.id, pushed.version, { title: "Pay rent (late)" });
    await sync.runAll(ctx, C);
    expect(stores.b.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect((await agenda.get(actor(C), other.id)).googleAccount).toBe(TWO);
    expect(stores.a.requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
    expect(stores.b.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
    expect(stores.a.events.get(pushed.googleEventId!)!.summary).toBe("Pay rent (late)");
  });

  test("items and the cursor from before accounts existed are adopted by the first account", async () => {
    await agenda.setSyncSettings(actor(D), { enabled: true });
    await db
      .update(agendaSync)
      .set({ syncToken: "legacy-tok" })
      .where(eq(agendaSync.ownerUserId, D));
    const [old] = await db
      .insert(agendaItem)
      .values({
        ownerUserId: D,
        title: "Old",
        startAt: new Date("2026-10-28T12:00:00Z"),
        source: "google",
        googleEventId: "old1",
        googleEtag: '"1"',
        syncToGoogle: true,
        syncState: "synced",
      })
      .returning();
    stores.a.events.set("old1", {
      id: "old1",
      etag: '"2"',
      summary: "Old (moved)",
      start: { dateTime: "2026-10-28T12:00:00Z" },
    });
    stores.a.changed.add("old1");
    await sync.runAll(gaccts(D, { email: ONE, token: "a" }, { email: TWO, token: "b" }), D);
    expect(stores.a.requests.find((r) => r.method === "GET")!.query).toContain(
      "syncToken=legacy-tok",
    );
    const linked = await db
      .select()
      .from(agendaItem)
      .where(and(eq(agendaItem.ownerUserId, D), eq(agendaItem.googleEventId, "old1")));
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ id: old!.id, googleAccount: ONE, title: "Old (moved)" });
    const [st] = await db.select().from(agendaSync).where(eq(agendaSync.ownerUserId, D));
    expect(st!.syncToken).toBeNull();
    expect(Object.keys(st!.syncTokens).sort()).toEqual([ONE, TWO]);
  });

  test("a failing or removed account never stops the others", async () => {
    await agenda.setSyncSettings(actor(E), { enabled: true });
    await db.insert(agendaItem).values({
      ownerUserId: E,
      title: "Gone",
      startAt: new Date("2026-10-28T12:00:00Z"),
      googleAccount: "gone@example.invalid",
      googleEventId: "gone1",
      syncToGoogle: true,
      syncState: "pending_push",
    });
    stores.b.deny = true;
    stores.a.events.set("ok1", {
      id: "ok1",
      etag: '"1"',
      summary: "Fine",
      start: { dateTime: "2026-10-29T12:00:00Z" },
    });
    const run = await sync.runAll(
      gaccts(E, { email: ONE, token: "a" }, { email: TWO, token: "b" }),
      E,
    );
    expect(run.results.map((r) => [r.email, r.ok ? "ok" : r.error.code])).toEqual([
      [ONE, "ok"],
      [TWO, "FORBIDDEN"],
    ]);
    expect(
      (
        await db
          .select()
          .from(agendaItem)
          .where(and(eq(agendaItem.ownerUserId, E), eq(agendaItem.googleEventId, "ok1")))
      ).map((r) => r.title),
    ).toEqual(["Fine"]);
    const [gone] = await db
      .select()
      .from(agendaItem)
      .where(and(eq(agendaItem.ownerUserId, E), eq(agendaItem.googleEventId, "gone1")));
    expect(gone).toMatchObject({ syncState: "error" });
    expect(gone!.syncError).toContain("gone@example.invalid");
  });

  test("an account that must reconnect is named in the sync error and in one attention item", async () => {
    await agenda.setSyncSettings(actor(F), { enabled: true });
    await db.insert(agendaItem).values({
      ownerUserId: F,
      title: "Held by two",
      startAt: new Date("2026-10-28T12:00:00Z"),
      googleAccount: TWO,
      googleEventId: "held1",
      syncToGoogle: true,
      syncState: "synced",
    });
    const ctx = gaccts(F, { email: ONE, token: "a" }, { email: TWO });
    const scheduler = createAgendaScheduler(db, { contextFor: async () => ctx }, async () => ({
      isAdmin: false,
    }));
    const r = await scheduler.syncUser(actor(F));
    expect(r.ok).toBe(false);
    const [st] = await db.select().from(agendaSync).where(eq(agendaSync.ownerUserId, F));
    expect(st!.lastError).toContain(TWO);
    expect(st!.lastError).not.toContain(ONE);
    const cards = await db
      .select()
      .from(attentionItem)
      .where(
        and(eq(attentionItem.ownerUserId, F), eq(attentionItem.sourceKey, "agenda-sync:auth")),
      );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.detail).toContain(TWO);
  });

  test("routes and the zetta:agenda bot tool: writes apply with a receipt, reads stay allowed after outside content", async () => {
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
    let script: string[] = [];
    const fakeRun = Object.assign(
      async () => ({ text: script.shift() ?? "done", stopped: false }),
      {
        stream: async function* () {
          yield script.shift() ?? "done";
        },
      },
    );
    const chat = createChatService(
      db,
      fakeRun as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      agenda,
    );
    const app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: { access, chat } as never,
      agenda: {
        access,
        agenda,
        scheduler: createAgendaScheduler(db, undefined, async () => ({ isAdmin: false })),
      },
      webOrigin: "http://web.test",
      desktopOrigins: [],
    });
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
      return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
    };
    const created = await call(A, "POST", "/api/agenda", {
      kind: "note",
      title: "Bring ID",
      startAt: "2026-12-01T09:00:00-03:00",
    });
    expect(created.status).toBe(201);
    expect((await call(B, "GET", `/api/agenda/${created.json.item.id}`)).status).toBe(404);
    expect(
      (
        await call(A, "GET", "/api/agenda?from=2026-12-01T00:00:00Z&to=2026-12-02T00:00:00Z")
      ).json.items.map((i: { title: string }) => i.title),
    ).toContain("Bring ID");
    expect(
      (await call(A, "POST", `/api/agenda/${created.json.item.id}/complete`, { done: true })).json
        .item.status,
    ).toBe("done");

    const bot = (await call(A, "POST", "/api/bots", { name: "Planner" })).json.bot as {
      id: string;
    };
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    script = [
      'On it.\n```zetta:agenda\n{"action":"add","kind":"reminder","title":"Call Ana","start":"2026-12-02T09:00:00-03:00"}\n```',
    ];
    const r = await call(A, "POST", `/api/conversations/${conv}/messages`, {
      content: "remind me to call Ana on Dec 2 at 9",
    });
    expect(r.json.assistant.content).toContain("Added to your Agenda");
    expect(r.json.assistant.content).not.toContain("zetta:");
    const [added] = await db
      .select()
      .from(agendaItem)
      .where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.title, "Call Ana")));
    expect(added).toMatchObject({
      kind: "reminder",
      source: "bot",
      createdByBotId: bot.id,
      conversationId: conv,
    });
    expect(added!.startAt.toISOString()).toBe("2026-12-02T12:00:00.000Z");

    // After a tool result (outside content), a write waits for an Approve card but the list read went through.
    script = [
      '```zetta:agenda\n{"action":"list","from":"2026-12-01T00:00:00Z","to":"2026-12-03T00:00:00Z"}\n```',
      '```zetta:agenda\n{"action":"add","title":"Injected","start":"2026-12-02T10:00:00Z"}\n```',
    ];
    const r2 = await call(A, "POST", `/api/conversations/${conv}/messages`, {
      content: "what is on my agenda?",
    });
    expect(r2.json.assistant.content).toContain("Read your Agenda");
    expect(
      await db
        .select()
        .from(agendaItem)
        .where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.title, "Injected"))),
    ).toHaveLength(0);
    const injected = async () =>
      db
        .select()
        .from(agendaItem)
        .where(and(eq(agendaItem.ownerUserId, A), eq(agendaItem.title, "Injected")));
    const cards = (
      (await call(A, "GET", "/api/proposals")).json.proposals as {
        id: string;
        kind: string;
        diff: { field: string; from: null; to: string }[];
      }[]
    ).filter((p) => p.kind === "bot_action");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.diff).toEqual([{ field: "agenda", from: null, to: "agenda add" }]);
    // Reject: nothing happens. A second ask and Approve: the item exists.
    await call(A, "POST", `/api/proposals/${cards[0]!.id}/decision`, { approve: false });
    expect(await injected()).toHaveLength(0);
    script = [
      '```zetta:agenda\n{"action":"list","from":"2026-12-01T00:00:00Z","to":"2026-12-03T00:00:00Z"}\n```',
      '```zetta:agenda\n{"action":"add","title":"Injected","start":"2026-12-02T10:00:00Z"}\n```',
    ];
    await call(A, "POST", `/api/conversations/${conv}/messages`, { content: "and again" });
    const [again] = (
      (await call(A, "GET", "/api/proposals")).json.proposals as {
        id: string;
        kind: string;
      }[]
    ).filter((p) => p.kind === "bot_action");
    expect(
      (await call(A, "POST", `/api/proposals/${again!.id}/decision`, { approve: true })).json
        .status,
    ).toBe("approved");
    expect(await injected()).toHaveLength(1);
    expect(
      (await db.select().from(agendaSync).where(eq(agendaSync.ownerUserId, A)))[0]?.enabled,
    ).toBe(true);
  });
});

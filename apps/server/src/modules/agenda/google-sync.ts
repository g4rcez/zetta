import type { Database } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { agendaItem, agendaSync } from "@zetta/db/schema/agenda";
import { gfetch, grantedScopes, needScope, settings } from "../integrations/plugins/google/oauth";
import { PluginError, type PluginContext } from "../integrations/plugins/registry";

/**
 * Two-way sync between a user's Agenda and their primary Google Calendar.
 *   push: local items in `pending_push` / `pending_delete` are written to Google (no guests, `sendUpdates=none`), guarded by the etag.
 *   pull: incremental with Google's syncToken (a 410 restarts with a bounded full window); local items waiting to be pushed win.
 * Google text (titles, descriptions) is stored as data and only shown to bots inside the untrusted-data envelope.
 */
type GDate = { dateTime?: string; date?: string; timeZone?: string };
type GEvent = { id?: string; etag?: string; status?: string; summary?: string; description?: string; location?: string; start?: GDate; end?: GDate };
type Row = typeof agendaItem.$inferSelect;

const DAY = 86_400_000, PAST_DAYS = 30, FUTURE_DAYS = 180, MAX_PAGES = 20, PUSH_BATCH = 50;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseGDate = (g: GDate | undefined) => g?.dateTime ? new Date(g.dateTime) : g?.date ? new Date(`${g.date}T00:00:00Z`) : undefined;

/** Agenda item → Google event body. Untimed kinds get a short slot so they are visible on the calendar. */
export function toGoogle(r: Pick<Row, "title" | "description" | "location" | "startAt" | "endAt" | "allDay" | "timezone">) {
  const base = { summary: r.title, description: r.description || undefined, location: r.location || undefined };
  if (r.allDay) {
    const end = r.endAt && r.endAt.getTime() > r.startAt.getTime() ? r.endAt : new Date(r.startAt.getTime() + DAY);
    return { ...base, start: { date: ymd(r.startAt) }, end: { date: ymd(end) } };
  }
  const end = r.endAt && r.endAt.getTime() > r.startAt.getTime() ? r.endAt : new Date(r.startAt.getTime() + 30 * 60_000);
  return { ...base, start: { dateTime: r.startAt.toISOString(), timeZone: r.timezone }, end: { dateTime: end.toISOString(), timeZone: r.timezone } };
}

/** Google event → Agenda fields, or undefined when it has no usable start. */
export function fromGoogle(e: GEvent) {
  const startAt = parseGDate(e.start); if (!startAt || Number.isNaN(startAt.getTime())) return undefined;
  const endAt = parseGDate(e.end) ?? null;
  return {
    title: (e.summary ?? "(no title)").slice(0, 200), description: (e.description ?? "").slice(0, 4000), location: (e.location ?? "").slice(0, 200),
    startAt, endAt, allDay: Boolean(e.start?.date && !e.start.dateTime), timezone: e.start?.timeZone ?? "UTC",
  };
}

export function createGoogleAgendaSync(db: Database) {
  const eventsUrl = (id?: string) => `${settings().calendarBase}/calendars/primary/events${id ? `/${encodeURIComponent(id)}` : ""}`;
  const canWrite = (ctx: PluginContext) => grantedScopes(ctx.config).has("calendar.events");

  async function push(ctx: PluginContext, userId: string) {
    const rows = await db.select().from(agendaItem).where(and(eq(agendaItem.ownerUserId, userId), inArray(agendaItem.syncState, ["pending_push", "pending_delete"]))).limit(PUSH_BATCH);
    if (!rows.length) return { pushed: 0 };
    if (!canWrite(ctx)) {
      await db.update(agendaItem).set({ syncState: "error", syncError: "Google Calendar was connected read-only. Reconnect Google with “Calendar: create and edit events” to send items." })
        .where(and(eq(agendaItem.ownerUserId, userId), eq(agendaItem.syncState, "pending_push")));
      return { pushed: 0 };
    }
    let pushed = 0;
    for (const r of rows) {
      try {
        if (r.syncState === "pending_delete") {
          if (r.googleEventId) {
            const u = new URL(eventsUrl(r.googleEventId)); u.searchParams.set("sendUpdates", "none");
            await gfetch(ctx, u.toString(), { method: "DELETE" }).catch((e) => { if (!(e instanceof PluginError && (e.code === "NOT_FOUND" || e.code === "GONE"))) throw e; });
          }
          await db.update(agendaItem).set({ syncState: "local", googleEventId: null, googleEtag: null }).where(and(eq(agendaItem.id, r.id), eq(agendaItem.version, r.version)));
        } else {
          const body = toGoogle(r);
          const send = async (method: "POST" | "PATCH", etag?: string | null) => {
            const u = new URL(method === "POST" ? eventsUrl() : eventsUrl(r.googleEventId!)); u.searchParams.set("sendUpdates", "none");
            return (await gfetch(ctx, u.toString(), { method, json: body, headers: etag ? { "if-match": etag } : undefined })).json() as Promise<GEvent>;
          };
          let ev: GEvent;
          if (!r.googleEventId) ev = await send("POST");
          else {
            // The user's edit is the newest intent: on an etag conflict it is applied over Google's copy, and a vanished event is recreated.
            try { ev = await send("PATCH", r.googleEtag); }
            catch (e) {
              if (e instanceof PluginError && e.code === "PRECONDITION_FAILED") ev = await send("PATCH");
              else if (e instanceof PluginError && (e.code === "NOT_FOUND" || e.code === "GONE")) ev = await send("POST");
              else throw e;
            }
          }
          await db.update(agendaItem).set({ googleEventId: ev.id ?? r.googleEventId, googleEtag: ev.etag ?? null }).where(eq(agendaItem.id, r.id));
          // Edited again while we were pushing: stay pending so the newer version goes out next time.
          await db.update(agendaItem).set({ syncState: "synced", syncError: "" }).where(and(eq(agendaItem.id, r.id), eq(agendaItem.version, r.version)));
        }
        pushed++;
      } catch (e) {
        if (e instanceof PluginError && (e.code === "NEEDS_AUTH" || e.code === "SCOPE_MISSING" || e.code === "RATE_LIMITED" || e.code === "GOOGLE_UNAVAILABLE")) throw e;
        await db.update(agendaItem).set({ syncState: "error", syncError: e instanceof PluginError ? e.safe : "Could not send this item to Google." }).where(eq(agendaItem.id, r.id));
      }
    }
    return { pushed };
  }

  async function apply(userId: string, e: GEvent) {
    if (!e.id) return;
    const [cur] = await db.select().from(agendaItem).where(and(eq(agendaItem.ownerUserId, userId), eq(agendaItem.googleEventId, e.id)));
    if (cur && (cur.syncState === "pending_push" || cur.syncState === "pending_delete")) return; // the local change goes out first
    if (e.status === "cancelled") {
      if (cur && !cur.archived) await db.update(agendaItem).set({ archived: true, syncState: "synced", version: cur.version + 1, updatedAt: new Date() }).where(eq(agendaItem.id, cur.id));
      return;
    }
    const v = fromGoogle(e); if (!v) return;
    if (!cur) {
      await db.insert(agendaItem).values({ ownerUserId: userId, kind: "event", source: "google", ...v, googleEventId: e.id, googleEtag: e.etag ?? null, syncToGoogle: true, syncState: "synced" })
        .onConflictDoNothing();
      return;
    }
    if (cur.googleEtag === e.etag && !cur.archived) return;
    await db.update(agendaItem).set({ ...v, archived: false, googleEtag: e.etag ?? null, syncState: "synced", syncError: "", version: cur.version + 1, updatedAt: new Date() }).where(eq(agendaItem.id, cur.id));
  }

  async function pull(ctx: PluginContext, userId: string, now = new Date()) {
    needScope(ctx, "calendar.events.readonly", "calendar.events");
    const [st] = await db.select({ token: agendaSync.syncToken }).from(agendaSync).where(eq(agendaSync.ownerUserId, userId));
    const run = async (token: string | null) => {
      let page: string | undefined; let next: string | undefined; let seen = 0;
      for (let i = 0; i < MAX_PAGES; i++) {
        const u = new URL(eventsUrl());
        u.searchParams.set("singleEvents", "true"); u.searchParams.set("maxResults", "250");
        if (token) u.searchParams.set("syncToken", token);
        else { u.searchParams.set("timeMin", new Date(now.getTime() - PAST_DAYS * DAY).toISOString()); u.searchParams.set("timeMax", new Date(now.getTime() + FUTURE_DAYS * DAY).toISOString()); }
        if (page) u.searchParams.set("pageToken", page);
        const j = await (await gfetch(ctx, u.toString())).json() as { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };
        for (const e of j.items ?? []) { await apply(userId, e); seen++; }
        page = j.nextPageToken; next = j.nextSyncToken ?? next;
        if (!page) break;
      }
      return { seen, next };
    };
    let r;
    try { r = await run(st?.token ?? null); }
    catch (e) { if (!(e instanceof PluginError && e.code === "GONE") || !st?.token) throw e; r = await run(null); } // expired sync position: start over
    if (r.next) await db.update(agendaSync).set({ syncToken: r.next }).where(eq(agendaSync.ownerUserId, userId));
    return { pulled: r.seen };
  }

  /** One full round for a user: local changes out first, then Google's changes in. */
  async function run(ctx: PluginContext, userId: string, now = new Date()) {
    const out = await push(ctx, userId);
    const inn = await pull(ctx, userId, now);
    return { ...out, ...inn, readOnly: !canWrite(ctx) };
  }
  return { push, pull, run };
}
export type GoogleAgendaSync = ReturnType<typeof createGoogleAgendaSync>;

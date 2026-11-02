import type { Database } from "@zetta/db";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "@zetta/db/query";
import { agendaItem, agendaSync } from "@zetta/db/schema/agenda";
import {
  accountCtx,
  accountLabel,
  gfetch,
  grantedScopes,
  needScope,
  pickAccount,
  readAccounts,
  settings,
  type GoogleAccount,
} from "../integrations/plugins/google/oauth";
import { PluginError, type PluginContext } from "../integrations/plugins/registry";

/**
 * Two-way sync between a user's Agenda and the primary Google Calendar of EVERY Google account they connected.
 *   push: local items in `pending_push` / `pending_delete` are written to Google (no guests, `sendUpdates=none`), guarded by the etag.
 *         An item goes to the account that holds it (`google_account`); a new item goes to the "push account".
 *   pull: incremental with Google's syncToken, one cursor per account (a 410 restarts with a bounded full window); local items waiting
 *         to be pushed win. The same event id in two calendars (an invitation) is two items, one per account.
 * Google text (titles, descriptions) is stored as data and only shown to bots inside the untrusted-data envelope.
 */
type GDate = { dateTime?: string; date?: string; timeZone?: string };
type GEvent = {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GDate;
  end?: GDate;
};
type Row = typeof agendaItem.$inferSelect;
export type AccountResult = { email: string } & (
  | { ok: true; pushed: number; pulled: number; readOnly: boolean }
  | { ok: false; error: PluginError }
);
const PENDING = ["pending_push", "pending_delete"] as const;
const hasCalendar = (a: GoogleAccount) => {
  const s = grantedScopes(a);
  return s.has("calendar.events") || s.has("calendar.events.readonly");
};

const DAY = 86_400_000,
  PAST_DAYS = 30,
  FUTURE_DAYS = 180,
  MAX_PAGES = 20,
  PUSH_BATCH = 50;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseGDate = (g: GDate | undefined) =>
  g?.dateTime ? new Date(g.dateTime) : g?.date ? new Date(`${g.date}T00:00:00Z`) : undefined;

/** Agenda item → Google event body. Untimed kinds get a short slot so they are visible on the calendar. */
export function toGoogle(
  r: Pick<Row, "title" | "description" | "location" | "startAt" | "endAt" | "allDay" | "timezone">,
) {
  const base = {
    summary: r.title,
    description: r.description || undefined,
    location: r.location || undefined,
  };
  if (r.allDay) {
    const end =
      r.endAt && r.endAt.getTime() > r.startAt.getTime()
        ? r.endAt
        : new Date(r.startAt.getTime() + DAY);
    return { ...base, start: { date: ymd(r.startAt) }, end: { date: ymd(end) } };
  }
  const end =
    r.endAt && r.endAt.getTime() > r.startAt.getTime()
      ? r.endAt
      : new Date(r.startAt.getTime() + 30 * 60_000);
  return {
    ...base,
    start: { dateTime: r.startAt.toISOString(), timeZone: r.timezone },
    end: { dateTime: end.toISOString(), timeZone: r.timezone },
  };
}

/** Google event → Agenda fields, or undefined when it has no usable start. */
export function fromGoogle(e: GEvent) {
  const startAt = parseGDate(e.start);
  if (!startAt || Number.isNaN(startAt.getTime())) return undefined;
  const endAt = parseGDate(e.end) ?? null;
  return {
    title: (e.summary ?? "(no title)").slice(0, 200),
    description: (e.description ?? "").slice(0, 4000),
    location: (e.location ?? "").slice(0, 200),
    startAt,
    endAt,
    allDay: Boolean(e.start?.date && !e.start.dateTime),
    timezone: e.start?.timeZone ?? "UTC",
  };
}

export function createGoogleAgendaSync(db: Database) {
  const eventsUrl = (id?: string) =>
    `${settings().calendarBase}/calendars/primary/events${id ? `/${encodeURIComponent(id)}` : ""}`;
  const canWrite = (ctx: PluginContext) => grantedScopes(ctx.config).has("calendar.events");

  /** Items this account is responsible for: the ones it holds, plus the not yet assigned ones when it is the push account. */
  const forAccount = (email: string, takesNew: boolean) =>
    takesNew
      ? or(eq(agendaItem.googleAccount, email), isNull(agendaItem.googleAccount))
      : eq(agendaItem.googleAccount, email);

  async function push(ctx: PluginContext, userId: string, email: string, takesNew: boolean) {
    const mine = and(eq(agendaItem.ownerUserId, userId), forAccount(email, takesNew));
    const rows = await db
      .select()
      .from(agendaItem)
      .where(and(mine, inArray(agendaItem.syncState, [...PENDING])))
      .limit(PUSH_BATCH);
    if (!rows.length) return { pushed: 0 };
    if (!canWrite(ctx)) {
      await db
        .update(agendaItem)
        .set({
          syncState: "error",
          syncError: `Google Calendar of ${accountLabel(email)} was connected read-only. Reconnect Google with “Calendar: create and edit events” to send items.`,
        })
        .where(and(mine, eq(agendaItem.syncState, "pending_push")));
      return { pushed: 0 };
    }
    let pushed = 0;
    for (const r of rows) {
      try {
        if (r.syncState === "pending_delete") {
          if (r.googleEventId) {
            const u = new URL(eventsUrl(r.googleEventId));
            u.searchParams.set("sendUpdates", "none");
            await gfetch(ctx, u.toString(), { method: "DELETE" }).catch((e) => {
              if (!(e instanceof PluginError && (e.code === "NOT_FOUND" || e.code === "GONE")))
                throw e;
            });
          }
          await db
            .update(agendaItem)
            .set({ syncState: "local", googleEventId: null, googleEtag: null })
            .where(and(eq(agendaItem.id, r.id), eq(agendaItem.version, r.version)));
        } else {
          const body = toGoogle(r);
          const send = async (method: "POST" | "PATCH", etag?: string | null) => {
            const u = new URL(method === "POST" ? eventsUrl() : eventsUrl(r.googleEventId!));
            u.searchParams.set("sendUpdates", "none");
            return (
              await gfetch(ctx, u.toString(), {
                method,
                json: body,
                headers: etag ? { "if-match": etag } : undefined,
              })
            ).json() as Promise<GEvent>;
          };
          let ev: GEvent;
          if (!r.googleEventId) ev = await send("POST");
          else {
            // The user's edit is the newest intent: on an etag conflict it is applied over Google's copy, and a vanished event is recreated.
            try {
              ev = await send("PATCH", r.googleEtag);
            } catch (e) {
              if (e instanceof PluginError && e.code === "PRECONDITION_FAILED")
                ev = await send("PATCH");
              else if (e instanceof PluginError && (e.code === "NOT_FOUND" || e.code === "GONE"))
                ev = await send("POST");
              else throw e;
            }
          }
          await db
            .update(agendaItem)
            .set({
              googleAccount: email,
              googleEventId: ev.id ?? r.googleEventId,
              googleEtag: ev.etag ?? null,
            })
            .where(eq(agendaItem.id, r.id));
          // Edited again while we were pushing: stay pending so the newer version goes out next time.
          await db
            .update(agendaItem)
            .set({ syncState: "synced", syncError: "" })
            .where(and(eq(agendaItem.id, r.id), eq(agendaItem.version, r.version)));
        }
        pushed++;
      } catch (e) {
        if (
          e instanceof PluginError &&
          (e.code === "NEEDS_AUTH" ||
            e.code === "SCOPE_MISSING" ||
            e.code === "RATE_LIMITED" ||
            e.code === "GOOGLE_UNAVAILABLE")
        )
          throw e;
        await db
          .update(agendaItem)
          .set({
            syncState: "error",
            syncError: e instanceof PluginError ? e.safe : "Could not send this item to Google.",
          })
          .where(eq(agendaItem.id, r.id));
      }
    }
    return { pushed };
  }

  async function apply(userId: string, email: string, e: GEvent) {
    if (!e.id) return;
    const [cur] = await db
      .select()
      .from(agendaItem)
      .where(
        and(
          eq(agendaItem.ownerUserId, userId),
          eq(agendaItem.googleAccount, email),
          eq(agendaItem.googleEventId, e.id),
        ),
      );
    if (cur && (cur.syncState === "pending_push" || cur.syncState === "pending_delete")) return; // the local change goes out first
    if (e.status === "cancelled") {
      if (cur && !cur.archived)
        await db
          .update(agendaItem)
          .set({
            archived: true,
            syncState: "synced",
            version: cur.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(agendaItem.id, cur.id));
      return;
    }
    const v = fromGoogle(e);
    if (!v) return;
    if (!cur) {
      await db
        .insert(agendaItem)
        .values({
          ownerUserId: userId,
          kind: "event",
          source: "google",
          ...v,
          googleAccount: email,
          googleEventId: e.id,
          googleEtag: e.etag ?? null,
          syncToGoogle: true,
          syncState: "synced",
        })
        .onConflictDoNothing();
      return;
    }
    if (cur.googleEtag === e.etag && !cur.archived) return;
    await db
      .update(agendaItem)
      .set({
        ...v,
        archived: false,
        googleEtag: e.etag ?? null,
        syncState: "synced",
        syncError: "",
        version: cur.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(agendaItem.id, cur.id));
  }

  async function pull(ctx: PluginContext, userId: string, email: string, now = new Date()) {
    needScope(ctx, "calendar.events.readonly", "calendar.events");
    const [st] = await db
      .select({ tokens: agendaSync.syncTokens })
      .from(agendaSync)
      .where(eq(agendaSync.ownerUserId, userId));
    const cursor = st?.tokens?.[email] ?? null;
    const run = async (token: string | null) => {
      let page: string | undefined;
      let next: string | undefined;
      let seen = 0;
      for (let i = 0; i < MAX_PAGES; i++) {
        const u = new URL(eventsUrl());
        u.searchParams.set("singleEvents", "true");
        u.searchParams.set("maxResults", "250");
        if (token) u.searchParams.set("syncToken", token);
        else {
          u.searchParams.set("timeMin", new Date(now.getTime() - PAST_DAYS * DAY).toISOString());
          u.searchParams.set("timeMax", new Date(now.getTime() + FUTURE_DAYS * DAY).toISOString());
        }
        if (page) u.searchParams.set("pageToken", page);
        const j = (await (await gfetch(ctx, u.toString())).json()) as {
          items?: GEvent[];
          nextPageToken?: string;
          nextSyncToken?: string;
        };
        for (const e of j.items ?? []) {
          await apply(userId, email, e);
          seen++;
        }
        page = j.nextPageToken;
        next = j.nextSyncToken ?? next;
        if (!page) break;
      }
      return { seen, next };
    };
    let r;
    try {
      r = await run(cursor);
    } catch (e) {
      if (!(e instanceof PluginError && e.code === "GONE") || !cursor) throw e;
      r = await run(null);
    } // expired sync position: start over
    if (r.next)
      await db
        .update(agendaSync)
        .set({
          syncTokens: sql`${agendaSync.syncTokens} || ${JSON.stringify({ [email]: r.next })}::jsonb`,
        })
        .where(eq(agendaSync.ownerUserId, userId));
    return { pulled: r.seen };
  }

  /** One full round for one account: local changes out first, then Google's changes in. `ctx` is that account's own view. */
  async function run(
    ctx: PluginContext,
    userId: string,
    email: string,
    takesNew: boolean,
    now = new Date(),
  ) {
    const out = await push(ctx, userId, email, takesNew);
    const inn = await pull(ctx, userId, email, now);
    return { ...out, ...inn, readOnly: !canWrite(ctx) };
  }

  /** Items and the cursor saved before accounts existed belong to the first account (the one the old single connection became). */
  async function adopt(userId: string, first: string) {
    await db
      .update(agendaItem)
      .set({ googleAccount: first })
      .where(
        and(
          eq(agendaItem.ownerUserId, userId),
          isNull(agendaItem.googleAccount),
          isNotNull(agendaItem.googleEventId),
        ),
      );
    const [st] = await db
      .select({ token: agendaSync.syncToken })
      .from(agendaSync)
      .where(eq(agendaSync.ownerUserId, userId));
    if (st?.token)
      await db
        .update(agendaSync)
        .set({
          syncToken: null,
          syncTokens: sql`jsonb_build_object(${first}::text, ${st.token}::text) || ${agendaSync.syncTokens}`,
        })
        .where(eq(agendaSync.ownerUserId, userId));
  }

  /** A change waiting for an account the user no longer has can never be sent: say so on the item instead of leaving it pending. */
  async function failOrphans(userId: string, known: Set<string>) {
    const waiting = await db
      .select({ id: agendaItem.id, account: agendaItem.googleAccount })
      .from(agendaItem)
      .where(
        and(
          eq(agendaItem.ownerUserId, userId),
          inArray(agendaItem.syncState, [...PENDING]),
          isNotNull(agendaItem.googleAccount),
        ),
      );
    const byAccount = new Map<string, string[]>();
    for (const r of waiting)
      if (!known.has(r.account!))
        byAccount.set(r.account!, [...(byAccount.get(r.account!) ?? []), r.id]);
    for (const [account, ids] of byAccount)
      await db
        .update(agendaItem)
        .set({
          syncState: "error",
          syncError: `${account} is no longer connected to Zetta. Reconnect it to send this change to Google Calendar.`,
        })
        .where(inArray(agendaItem.id, ids));
  }

  /**
   * One round for every Google account of the user that has a Calendar permission. `ctx` is the Google plugin's own context.
   * An account that fails (revoked, denied, offline) is reported in its result and never stops the others.
   * Throws when no account can use Calendar at all (NEEDS_AUTH / SCOPE_MISSING, in the plugin's usual words).
   */
  async function runAll(ctx: PluginContext, userId: string, now = new Date()) {
    const all = readAccounts(ctx.config);
    const usable = all.filter((a) => a.refreshToken && hasCalendar(a));
    if (!usable.length) {
      pickAccount(ctx, undefined, "calendar.events.readonly", "calendar.events");
      throw new PluginError("SCOPE_MISSING", "Google Calendar access was not granted.");
    }
    await adopt(userId, all[0]!.email);
    await failOrphans(userId, new Set(all.map((a) => a.email)));
    const [st] = await db
      .select({ push: agendaSync.pushAccount })
      .from(agendaSync)
      .where(eq(agendaSync.ownerUserId, userId));
    const takesNew = (
      usable.find((a) => a.email === st?.push) ??
      usable.find((a) => grantedScopes(a).has("calendar.events")) ??
      usable[0]!
    ).email;
    const results: AccountResult[] = [];
    for (const a of all) {
      if (!a.refreshToken) {
        // revoked: only worth a message when this account holds items
        const held = await db
          .select({ id: agendaItem.id })
          .from(agendaItem)
          .where(and(eq(agendaItem.ownerUserId, userId), eq(agendaItem.googleAccount, a.email)))
          .limit(1);
        if (held.length)
          results.push({
            email: a.email,
            ok: false,
            error: new PluginError(
              "NEEDS_AUTH",
              "Google access was revoked or expired. Reconnect Google in Studio > Plugins.",
            ),
          });
        continue;
      }
      if (!hasCalendar(a)) continue;
      try {
        results.push({
          email: a.email,
          ok: true,
          ...(await run(accountCtx(ctx, a.email), userId, a.email, a.email === takesNew, now)),
        });
      } catch (e) {
        results.push({
          email: a.email,
          ok: false,
          error:
            e instanceof PluginError
              ? e
              : new PluginError("SYNC_FAILED", "Google Calendar could not be synced right now."),
        });
      }
    }
    return { results, takesNew };
  }
  return { push, pull, run, runAll };
}
export type GoogleAgendaSync = ReturnType<typeof createGoogleAgendaSync>;

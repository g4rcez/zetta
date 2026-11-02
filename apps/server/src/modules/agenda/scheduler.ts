import type { Database } from "@zetta/db";
import { and, eq, isNull, lte } from "@zetta/db/query";
import { agendaItem, agendaSync } from "@zetta/db/schema/agenda";
import { raiseAttention } from "../features/attention";
import { issueBackgroundActor, type ActiveActor, type MembershipLookup } from "../identity/access";
import { accountLabel } from "../integrations/plugins/google/oauth";
import { PluginError, type PluginContext } from "../integrations/plugins/registry";
import { createGoogleAgendaSync } from "./google-sync";

export type AgendaPlugins = { contextFor: (a: ActiveActor, id: string) => Promise<PluginContext> };
const SYNC_EVERY_MS = 5 * 60_000,
  SYNC_USERS_PER_TICK = 10;

/**
 * Agenda background work, driven by the server's 30s tick:
 *   - due reminders become attention items (each claimed once by setting `reminded_at`),
 *   - users with Google sync on are synced every few minutes, every connected Google account in turn (each user claimed by moving `next_sync_at`).
 */
export function createAgendaScheduler(
  db: Database,
  plugins: AgendaPlugins | undefined,
  lookup: MembershipLookup,
) {
  const google = createGoogleAgendaSync(db);
  let busy = false;

  async function remind(now: Date) {
    const due = await db
      .update(agendaItem)
      .set({ remindedAt: now })
      .where(
        and(
          lte(agendaItem.remindAt, now),
          isNull(agendaItem.remindedAt),
          eq(agendaItem.status, "open"),
          eq(agendaItem.archived, false),
        ),
      )
      .returning();
    for (const r of due) {
      const when = r.allDay
        ? r.startAt.toISOString().slice(0, 10)
        : `${r.startAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
      await raiseAttention(db, r.ownerUserId, {
        title: `${r.kind === "task" ? "Task due" : r.kind === "event" ? "Coming up" : "Reminder"}: ${r.title}`,
        detail: [when, r.location, r.description].filter(Boolean).join("\n"),
        nextAction: "Open the Agenda to mark it done or move it.",
        resultLink: `/agenda?item=${r.id}`,
        botId: r.createdByBotId ?? undefined,
        source: r.createdByBotId ? "bot" : "manual",
        sourceKey: `agenda:${r.id}`,
      }).catch(() => {});
    }
    return due.length;
  }

  /** Syncs one user now. Errors are recorded on the sync row and returned in safe words. */
  async function syncUser(a: ActiveActor, now = new Date()) {
    let ctx: PluginContext;
    try {
      if (!plugins)
        throw new PluginError(
          "NOT_CONNECTED",
          "Google is not connected. Connect it in Studio > Plugins.",
        );
      ctx = await plugins.contextFor(a, "google").catch((e) => {
        throw e instanceof PluginError
          ? e
          : new PluginError(
              "NOT_CONNECTED",
              "Google is not connected. Connect it in Studio > Plugins.",
            );
      });
      const { results } = await google.runAll(ctx, a.userId, now);
      const failed = results.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok);
      const worked = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
      // With several accounts each message names its account; with one it reads as it always did.
      const lines = failed.map(
        (r) => `${results.length > 1 ? `${accountLabel(r.email)}: ` : ""}${r.error.safe}`,
      );
      await db
        .update(agendaSync)
        .set({ ...(worked.length ? { lastSyncedAt: now } : {}), lastError: lines.join("\n") })
        .where(eq(agendaSync.ownerUserId, a.userId));
      if (
        failed.some((r) => ["NEEDS_AUTH", "NOT_CONNECTED", "SCOPE_MISSING"].includes(r.error.code))
      )
        await raiseAttention(db, a.userId, {
          title: "Agenda cannot sync with Google Calendar",
          detail: lines.join("\n"),
          nextAction: "Reconnect Google in Studio > Plugins with Calendar access.",
          resultLink: "/studio/plugins?plugin=google",
          source: "manual",
          sourceKey: "agenda-sync:auth",
        }).catch(() => {});
      if (failed.length) return { ok: false as const, error: lines.join("\n") };
      return {
        ok: true as const,
        pushed: worked.reduce((n, r) => n + r.pushed, 0),
        pulled: worked.reduce((n, r) => n + r.pulled, 0),
        readOnly: worked.every((r) => r.readOnly),
      };
    } catch (e) {
      const p =
        e instanceof PluginError
          ? e
          : new PluginError("SYNC_FAILED", "Google Calendar could not be synced right now.");
      await db
        .update(agendaSync)
        .set({ lastError: p.safe })
        .where(eq(agendaSync.ownerUserId, a.userId));
      if (p.code === "NEEDS_AUTH" || p.code === "NOT_CONNECTED" || p.code === "SCOPE_MISSING")
        await raiseAttention(db, a.userId, {
          title: "Agenda cannot sync with Google Calendar",
          detail: p.safe,
          nextAction: "Reconnect Google in Studio > Plugins with Calendar access.",
          resultLink: "/studio/plugins?plugin=google",
          source: "manual",
          sourceKey: "agenda-sync:auth",
        }).catch(() => {});
      return { ok: false as const, error: p.safe };
    }
  }

  async function sync(now: Date) {
    const due = await db
      .update(agendaSync)
      .set({ nextSyncAt: new Date(now.getTime() + SYNC_EVERY_MS) })
      .where(and(eq(agendaSync.enabled, true), lte(agendaSync.nextSyncAt, now)))
      .returning({ ownerUserId: agendaSync.ownerUserId });
    for (const { ownerUserId } of due.slice(0, SYNC_USERS_PER_TICK)) {
      const a = await issueBackgroundActor(lookup, ownerUserId);
      if (a) await syncUser(a, now);
    }
    // Claimed but not reached this tick: try again on the next one.
    for (const { ownerUserId } of due.slice(SYNC_USERS_PER_TICK))
      await db
        .update(agendaSync)
        .set({ nextSyncAt: now })
        .where(eq(agendaSync.ownerUserId, ownerUserId));
  }

  return {
    syncUser,
    async tick(now = new Date()) {
      if (busy) return;
      busy = true; // a slow Google round must not overlap the next tick
      try {
        await remind(now);
        await sync(now);
      } finally {
        busy = false;
      }
    },
  };
}
export type AgendaScheduler = ReturnType<typeof createAgendaScheduler>;

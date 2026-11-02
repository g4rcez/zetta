import type { Database } from "@zetta/db";
import { and, asc, eq, gte, inArray, lt, sql } from "@zetta/db/query";
import { agendaItem, agendaSync } from "@zetta/db/schema/agenda";
import type { ActiveActor } from "../identity/access";

export class AgendaError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID",
    readonly detail?: string,
  ) {
    super(code);
  }
}

export const AGENDA_KINDS = ["event", "task", "reminder", "note"] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];
export type AgendaItem = typeof agendaItem.$inferSelect;
export type AgendaInput = {
  kind: AgendaKind;
  title: string;
  description?: string;
  location?: string;
  startAt: Date;
  endAt?: Date | null;
  allDay?: boolean;
  timezone?: string;
  remindAt?: Date | null;
  syncToGoogle?: boolean;
};
export type AgendaPatch = Partial<AgendaInput> & { status?: "open" | "done" | "cancelled" };
/** Who wrote an item: the user, or one of their bots during a conversation (trusted server values, never request input). */
export type AgendaOrigin = {
  source: "user" | "bot";
  botId?: string | null;
  conversationId?: string | null;
};

const MAX_RANGE_MS = 400 * 86_400_000;
/** Tasks and reminders remind at their start unless told otherwise; events and notes only when asked. */
const defaultRemind = (kind: AgendaKind, startAt: Date) =>
  kind === "task" || kind === "reminder" ? startAt : null;

function check(v: { title?: string; startAt?: Date; endAt?: Date | null; remindAt?: Date | null }) {
  if (v.title !== undefined && !v.title.trim())
    throw new AgendaError("INVALID", "A title is required.");
  for (const d of [v.startAt, v.endAt, v.remindAt])
    if (d && Number.isNaN(d.getTime())) throw new AgendaError("INVALID", "A date is not valid.");
  if (v.startAt && v.endAt && v.endAt.getTime() < v.startAt.getTime())
    throw new AgendaError("INVALID", "The end must be after the start.");
}

export function createAgenda(db: Database) {
  const own = (a: ActiveActor, id: string) =>
    and(
      eq(agendaItem.id, id),
      eq(agendaItem.ownerUserId, a.userId),
      eq(agendaItem.archived, false),
    );
  const one = async (a: ActiveActor, id: string) => {
    const [row] = await db.select().from(agendaItem).where(own(a, id));
    if (!row) throw new AgendaError("NOT_FOUND");
    return row;
  };
  const syncSettings = async (userId: string) =>
    (await db.select().from(agendaSync).where(eq(agendaSync.ownerUserId, userId)))[0];
  /** Pending Google writes are pushed on the next scheduler tick instead of waiting for the regular interval. */
  const nudge = (userId: string) =>
    db
      .update(agendaSync)
      .set({ nextSyncAt: new Date() })
      .where(and(eq(agendaSync.ownerUserId, userId), eq(agendaSync.enabled, true)));

  return {
    /** Items overlapping [from, to), oldest first. */
    async list(a: ActiveActor, from: Date, to: Date, kinds?: readonly AgendaKind[]) {
      if (to.getTime() <= from.getTime() || to.getTime() - from.getTime() > MAX_RANGE_MS)
        throw new AgendaError("INVALID", "Pick a shorter date range.");
      return db
        .select()
        .from(agendaItem)
        .where(
          and(
            eq(agendaItem.ownerUserId, a.userId),
            eq(agendaItem.archived, false),
            lt(agendaItem.startAt, to),
            gte(sql`coalesce(${agendaItem.endAt}, ${agendaItem.startAt})`, from),
            kinds?.length ? inArray(agendaItem.kind, [...kinds]) : undefined,
          ),
        )
        .orderBy(asc(agendaItem.startAt))
        .limit(1000);
    },
    get: one,
    async create(a: ActiveActor, v: AgendaInput, origin: AgendaOrigin = { source: "user" }) {
      check(v);
      const sync = await syncSettings(a.userId);
      const toGoogle = Boolean(sync?.enabled) && (v.syncToGoogle ?? Boolean(sync?.pushByDefault));
      const [row] = await db
        .insert(agendaItem)
        .values({
          ownerUserId: a.userId,
          kind: v.kind,
          title: v.title.trim().slice(0, 200),
          description: (v.description ?? "").slice(0, 4000),
          location: (v.location ?? "").slice(0, 200),
          startAt: v.startAt,
          endAt: v.endAt ?? null,
          allDay: v.allDay ?? false,
          timezone: v.timezone ?? "UTC",
          remindAt: v.remindAt !== undefined ? v.remindAt : defaultRemind(v.kind, v.startAt),
          source: origin.source,
          createdByBotId: origin.botId ?? null,
          conversationId: origin.conversationId ?? null,
          syncToGoogle: toGoogle,
          syncState: toGoogle ? "pending_push" : "local",
        })
        .returning();
      if (toGoogle) await nudge(a.userId);
      return row!;
    },
    async update(a: ActiveActor, id: string, expectedVersion: number, p: AgendaPatch) {
      check(p);
      const cur = await one(a, id);
      if (cur.version !== expectedVersion) throw new AgendaError("CONFLICT");
      const sync = await syncSettings(a.userId);
      const kind = p.kind ?? cur.kind;
      const startAt = p.startAt ?? cur.startAt;
      if (
        p.endAt === undefined &&
        p.startAt &&
        cur.endAt &&
        cur.endAt.getTime() < startAt.getTime()
      )
        throw new AgendaError("INVALID", "The end must be after the start.");
      // A reminder that followed the start keeps following it when the item moves.
      const followed = cur.remindAt && cur.remindAt.getTime() === cur.startAt.getTime();
      const remindAt =
        p.remindAt !== undefined
          ? p.remindAt
          : p.startAt && followed
            ? startAt
            : p.kind && !cur.remindAt
              ? defaultRemind(kind, startAt)
              : cur.remindAt;
      const toGoogle = p.syncToGoogle ?? cur.syncToGoogle;
      const linked = Boolean(cur.googleEventId) || (toGoogle && Boolean(sync?.enabled));
      const googleFields = [
        "title",
        "description",
        "location",
        "startAt",
        "endAt",
        "allDay",
        "kind",
      ] as const;
      const touchesGoogle =
        googleFields.some((f) => p[f] !== undefined) ||
        (p.syncToGoogle === true && !cur.googleEventId);
      const [row] = await db
        .update(agendaItem)
        .set({
          kind,
          title: p.title?.trim().slice(0, 200) ?? cur.title,
          description: p.description?.slice(0, 4000) ?? cur.description,
          location: p.location?.slice(0, 200) ?? cur.location,
          startAt,
          endAt: p.endAt !== undefined ? p.endAt : cur.endAt,
          allDay: p.allDay ?? cur.allDay,
          timezone: p.timezone ?? cur.timezone,
          status: p.status ?? cur.status,
          remindAt,
          remindedAt: remindAt?.getTime() !== cur.remindAt?.getTime() ? null : cur.remindedAt,
          syncToGoogle: toGoogle,
          syncState: linked && touchesGoogle ? "pending_push" : cur.syncState,
          syncError: linked && touchesGoogle ? "" : cur.syncError,
          version: cur.version + 1,
          updatedAt: new Date(),
        })
        .where(and(own(a, id), eq(agendaItem.version, expectedVersion)))
        .returning();
      if (!row) throw new AgendaError("CONFLICT");
      if (linked && touchesGoogle) await nudge(a.userId);
      return row;
    },
    async complete(a: ActiveActor, id: string, done = true) {
      const [row] = await db
        .update(agendaItem)
        .set({
          status: done ? "done" : "open",
          version: sql`${agendaItem.version} + 1`,
          updatedAt: new Date(),
        })
        .where(own(a, id))
        .returning();
      if (!row) throw new AgendaError("NOT_FOUND");
      return row;
    },
    /** Soft delete. An item that exists on Google is deleted there by the next push. */
    async remove(a: ActiveActor, id: string) {
      const cur = await one(a, id);
      const [row] = await db
        .update(agendaItem)
        .set({
          archived: true,
          syncState: cur.googleEventId ? "pending_delete" : cur.syncState,
          version: cur.version + 1,
          updatedAt: new Date(),
        })
        .where(own(a, id))
        .returning();
      if (cur.googleEventId) await nudge(a.userId);
      return row!;
    },
    async syncSettings(a: ActiveActor) {
      const s = await syncSettings(a.userId);
      return {
        enabled: s?.enabled ?? false,
        pushByDefault: s?.pushByDefault ?? false,
        pushAccount: s?.pushAccount ?? null,
        lastSyncedAt: s?.lastSyncedAt ?? null,
        lastError: s?.lastError ?? "",
      };
    },
    /** `pushAccount` is the email of the Google account that receives new items (null: the first account that can write). */
    async setSyncSettings(
      a: ActiveActor,
      v: { enabled?: boolean; pushByDefault?: boolean; pushAccount?: string | null },
    ) {
      const set = {
        ...(v.enabled !== undefined ? { enabled: v.enabled } : {}),
        ...(v.pushByDefault !== undefined ? { pushByDefault: v.pushByDefault } : {}),
        ...(v.pushAccount !== undefined
          ? { pushAccount: v.pushAccount?.trim().toLowerCase() || null }
          : {}),
        nextSyncAt: new Date(),
        ...(v.enabled === false ? { lastError: "" } : {}),
      };
      await db
        .insert(agendaSync)
        .values({
          ownerUserId: a.userId,
          enabled: v.enabled ?? false,
          pushByDefault: v.pushByDefault ?? false,
          pushAccount: v.pushAccount?.trim().toLowerCase() || null,
        })
        .onConflictDoUpdate({ target: agendaSync.ownerUserId, set });
      return this.syncSettings(a);
    },
  };
}
export type AgendaService = ReturnType<typeof createAgenda>;

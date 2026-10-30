import type { Database } from "@zetta/db";
import { and, eq, inArray, sql } from "@zetta/db/query";
import { attentionItem } from "@zetta/db/schema/features";

export type AttentionInput = {
  title: string;
  detail?: string;
  nextAction?: string;
  botId?: string | null;
  resultLink?: string | null;
  source?: (typeof attentionItem.$inferInsert)["source"];
  completed?: string;
  remaining?: string;
  /** Stable key for the situation (e.g. `routine:<id>:failed`). Repeats update the live card instead of adding another. */
  sourceKey?: string;
};

/**
 * Single producer for attention cards. With a sourceKey, a repeating situation reopens/updates one card and bumps `occurrences`;
 * without one, a new card is created. Never changes any run or approval: attention is separate from execution state.
 */
export async function raiseAttention(
  db: Pick<Database, "insert" | "update">,
  ownerUserId: string,
  v: AttentionInput,
) {
  const values = {
    ownerUserId,
    title: v.title.slice(0, 160),
    detail: (v.detail ?? "").slice(0, 4000),
    nextAction: (v.nextAction ?? "").slice(0, 500),
    botId: v.botId ?? null,
    resultLink: v.resultLink ?? null,
    source: v.source ?? "manual",
    completed: (v.completed ?? "").slice(0, 1000),
    remaining: (v.remaining ?? "").slice(0, 1000),
    sourceKey: v.sourceKey ?? null,
  };
  if (!v.sourceKey) {
    const [row] = await db.insert(attentionItem).values(values).returning();
    return row!;
  }
  const [row] = await db
    .insert(attentionItem)
    .values(values)
    .onConflictDoUpdate({
      target: [attentionItem.ownerUserId, attentionItem.sourceKey],
      targetWhere: sql`${attentionItem.sourceKey} is not null and ${attentionItem.status} in ('open', 'acknowledged')`,
      set: {
        occurrences: sql`${attentionItem.occurrences} + 1`,
        detail: values.detail,
        updatedAt: new Date(),
        status: "open",
        readAt: null,
      },
    })
    .returning();
  return row!;
}

/** Closes the live cards that link to `resultLink` once their subject ended (for example a resolved discussion), so they stop showing as noise. */
export async function closeAttention(
  db: Pick<Database, "update">,
  ownerUserId: string,
  resultLink: string,
  status: "resolved" | "cancelled",
) {
  await db
    .update(attentionItem)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(attentionItem.ownerUserId, ownerUserId),
        eq(attentionItem.resultLink, resultLink),
        inArray(attentionItem.status, ["open", "acknowledged"]),
      ),
    );
}

/** Read, acknowledge, resolve or cancel. Resolving requires the item to have been seen (acknowledged) first; cancelling is separate from resolving. */
export type AttentionAction = "read" | "acknowledge" | "resolve" | "cancel" | "reopen";
export async function applyAttentionAction(
  db: Pick<Database, "update" | "select">,
  ownerUserId: string,
  id: string,
  action: AttentionAction,
) {
  const [item] = await db
    .select()
    .from(attentionItem)
    .where(and(eq(attentionItem.id, id), eq(attentionItem.ownerUserId, ownerUserId)));
  if (!item) return undefined;
  const set: Partial<typeof attentionItem.$inferInsert> = { updatedAt: new Date() };
  if (action === "read") set.readAt = new Date();
  else if (action === "acknowledge") {
    set.status = "acknowledged";
    set.readAt = new Date();
  } else if (action === "resolve") {
    if (item.status === "open") set.readAt = new Date();
    set.status = "resolved";
  } else if (action === "cancel") set.status = "cancelled";
  else if (action === "reopen") {
    set.status = "open";
    set.readAt = null;
  }
  const [row] = await db
    .update(attentionItem)
    .set(set)
    .where(and(eq(attentionItem.id, id), eq(attentionItem.ownerUserId, ownerUserId)))
    .returning();
  return row;
}

export async function attentionSummary(db: Pick<Database, "select">, ownerUserId: string) {
  const rows = await db
    .select({
      status: attentionItem.status,
      unread: sql<number>`count(*) filter (where ${attentionItem.readAt} is null)`,
      n: sql<number>`count(*)`,
    })
    .from(attentionItem)
    .where(eq(attentionItem.ownerUserId, ownerUserId))
    .groupBy(attentionItem.status);
  const get = (s: string) => rows.find((r) => r.status === s);
  return {
    open: Number(get("open")?.n ?? 0),
    unread: Number(get("open")?.unread ?? 0),
    acknowledged: Number(get("acknowledged")?.n ?? 0),
  };
}

import type { Database } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { workWatch, type WorkWatchKind } from "@zetta/db/schema/work";

export type WatchRow = typeof workWatch.$inferSelect;
type Patch = Partial<Pick<WatchRow, "quietUntil" | "fingerprint" | "checkedAt" | "verdict">>;

/** What the scan remembers about tasks (schema/work.ts): one row per task and kind, written with an upsert. */
export function createWorkWatch(db: Pick<Database, "select" | "insert">) {
  return {
    async of(taskIds: readonly string[], kind: WorkWatchKind): Promise<Map<string, WatchRow>> {
      if (!taskIds.length) return new Map();
      const rows = await db
        .select()
        .from(workWatch)
        .where(and(inArray(workWatch.taskId, [...taskIds]), eq(workWatch.kind, kind)));
      return new Map(rows.map((r) => [r.taskId, r]));
    },
    async set(taskId: string, kind: WorkWatchKind, patch: Patch) {
      await db
        .insert(workWatch)
        .values({ taskId, kind, ...patch })
        .onConflictDoUpdate({
          target: [workWatch.taskId, workWatch.kind],
          set: { ...patch, updatedAt: new Date() },
        });
    },
  };
}
export type WorkWatch = ReturnType<typeof createWorkWatch>;

/**
 * Whether the scan stays silent about a task: somebody said "give it more time" or "it's fine as it is", that time has not passed, and
 * the task still looks the way it did then. A task that changed is looked at again at once.
 */
export const isQuiet = (row: WatchRow | undefined, fingerprint: string, now: Date) =>
  !!row?.quietUntil && +row.quietUntil > +now && row.fingerprint === fingerprint;

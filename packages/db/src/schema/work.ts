import { sql } from "drizzle-orm";
import { foreignKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";
import { inWorkspace } from "./workspace-table";

import { task } from "./tasks";

const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;

/** What is watched on a task: it stopped moving, it is blocked, it goes another way than asked, or its person was asked about it. */
export const WORK_WATCH_KINDS = ["stuck", "blocked", "drift", "checkin"] as const;
export type WorkWatchKind = (typeof WORK_WATCH_KINDS)[number];

/**
 * What the work scan remembers about one task and one kind of card, so it neither nags nor repeats a check. `quietUntil`: no card of this
 * kind before then (the manager said "give it more time" or "it's fine as it is"). `fingerprint`: what the task looked like at that
 * moment; a task that changed since is looked at again. `checkedAt`: when the check last ran, or when the person was last asked.
 */
export const workWatch = zetta.table(
  "work_watch",
  {
    workspaceId: inWorkspace(),
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, cascade),
    kind: text("kind", { enum: WORK_WATCH_KINDS }).notNull(),
    quietUntil: timestamp("quiet_until", { withTimezone: true }),
    fingerprint: text("fingerprint").default("").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** The last answer: of the check ("on_track", "drifting"), or of the person asked ("asked", "on_it"). */
    verdict: text("verdict").default("").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: "work_watch_task_id_workspace_fkey",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [task.id, task.workspaceId],
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    uniqueIndex("work_watch_task_kind_unique").on(t.taskId, t.kind),
  ],
);

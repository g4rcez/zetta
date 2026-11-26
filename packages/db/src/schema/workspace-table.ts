import { sql } from "drizzle-orm";
import { check, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { WORKSPACE_NAME_MAX, WORKSPACE_STATES } from "@zetta/core/workspace";
import { zetta } from "./pg-schema";

/**
 * One organization on this server (docs/decisions/workspaces.md). Every database has one from the migration that added workspaces to
 * every table: the first account becomes its owner and root. `slug` is the name the address carries.
 *
 * In a file of its own, with nothing to import but the schema, so every other table can point at it without a cycle.
 */
export const workspace = zetta.table(
  "workspace",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: WORKSPACE_STATES }).default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("workspace_slug_unique").on(t.slug),
    check("workspace_slug_check", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,62}$'`),
    check(
      "workspace_name_check",
      sql`length(${t.name}) between 1 and ${sql.raw(String(WORKSPACE_NAME_MAX))}`,
    ),
    check(
      "workspace_status_check",
      sql`${t.status} in ('active', 'suspended', 'deleting', 'deleted')`,
    ),
  ],
);

/**
 * The workspace a row belongs to. Its default is the workspace the connection is set to (`app.workspace_id`, set by the pool for the work
 * that runs, packages/db/src/tenant.ts), so an insert names it only when it writes for another workspace than its own. The row rule of
 * the table reads the same setting. A function declaration: a table file may call it while this file is still being loaded.
 */
export function inWorkspace() {
  return (
    uuid("workspace_id")
      .notNull()
      // `cast(... as uuid)`, not `::uuid`: drizzle-kit drops a trailing `::<type>` from a default, and a text default on a uuid column fails.
      .default(sql`cast(nullif(current_setting('app.workspace_id', true), '') as uuid)`)
      .references(() => workspace.id, { onDelete: "restrict", onUpdate: "restrict" })
  );
}

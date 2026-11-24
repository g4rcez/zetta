import { sql } from "drizzle-orm";
import { check, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { SETTING_KEY_MAX, SETTING_SCOPE_KINDS } from "@zetta/core/settings";
import { zetta } from "./pg-schema";

/**
 * One row per stored server setting (the registry is `@zetta/core/settings`). `scope_kind` is `installation` (the whole server, `scope_id`
 * null) or `workspace` (an organization's own value, `scope_id` its id). There is no foreign key on `scope_id`: the workspace table of
 * docs/decisions/workspaces.md does not exist yet, and the setting must not block its creation. `value` holds the JSON of the typed value
 * (a switch is the string "on" or "off"); the application validates it against the registry on every write. `updated_by` is the user id of
 * the person who saved it, null for a value imported from an environment variable at start-up. A missing row means the registry default.
 */
export const setting = zetta.table(
  "setting",
  {
    scopeKind: text("scope_kind", { enum: SETTING_SCOPE_KINDS }).notNull(),
    scopeId: uuid("scope_id"),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // `nulls not distinct`: the installation scope has a null `scope_id`, and two rows of the same key there must collide.
    unique("setting_scope_key_unique").on(t.scopeKind, t.scopeId, t.key).nullsNotDistinct(),
    check("setting_scope_kind_check", sql`${t.scopeKind} in ('installation', 'workspace')`),
    check(
      "setting_scope_id_check",
      sql`(${t.scopeKind} = 'installation') = (${t.scopeId} is null)`,
    ),
    check(
      "setting_key_check",
      sql`length(${t.key}) between 1 and ${sql.raw(String(SETTING_KEY_MAX))}`,
    ),
  ],
);

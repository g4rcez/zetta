import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/** Built-in styles live in code (`apps/server/src/modules/output-styles/builtins.ts`); `custom` points to an `output_style` row. */
export const OUTPUT_STYLE_KEYS = [
  "default",
  "proactive",
  "concise",
  "explanatory",
  "learning",
  "custom",
] as const;
export type OutputStyleKey = (typeof OUTPUT_STYLE_KEYS)[number];

/** private: only the owner. installation: every active member can read it and select it for their bots. */
export const OUTPUT_STYLE_SCOPES = ["private", "installation"] as const;
export type OutputStyleScope = (typeof OUTPUT_STYLE_SCOPES)[number];

/** A tone-of-voice template. Bots keep a live reference, so an edit reaches every bot that uses it. Delete = archive. */
export const outputStyle = pgTable(
  "output_style",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    body: text("body").notNull(),
    scope: text("scope", { enum: OUTPUT_STYLE_SCOPES }).default("private").notNull(),
    version: integer("version").default(1).notNull(),
    archived: boolean("archived").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("output_style_owner_idx").on(t.ownerUserId),
    check("output_style_name_check", sql`length(btrim(${t.name})) between 1 and 60`),
  ],
);

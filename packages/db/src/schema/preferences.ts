import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const RAIL_MODES = ["expanded", "collapsed"] as const;
export type RailMode = (typeof RAIL_MODES)[number];

/** Pixel limits and defaults for the two sidebars. The server clamps to these; the web app drags within them. */
export const SIDEBAR_LIMITS = {
  railWidth: { min: 192, max: 360, fallback: 224 },
  listWidth: { min: 240, max: 560, fallback: 320 },
} as const;

/** How one person arranges the workspace. One row per user; no row means every default. */
export const userPreference = pgTable("user_preference", {
  ownerUserId: text("owner_user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade", onUpdate: "restrict" }),
  railMode: text("rail_mode", { enum: RAIL_MODES }).default("expanded").notNull(),
  railWidth: integer("rail_width").default(SIDEBAR_LIMITS.railWidth.fallback).notNull(),
  listWidth: integer("list_width").default(SIDEBAR_LIMITS.listWidth.fallback).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const RAIL_MODES = ["expanded", "collapsed"] as const;
export type RailMode = (typeof RAIL_MODES)[number];

export const TIME_FORMATS = ["24h", "12h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

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
  /** How the web app shows the hour of day. */
  timeFormat: text("time_format", { enum: TIME_FORMATS }).default("24h").notNull(),
  /** The person's sidebar order of bots (ids, first on top). Only that person reads it; a bot missing from it sorts after, by
   * the server's order, so no foreign key is needed and a deleted bot just drops out. The chief is always first and never listed. */
  botOrder: uuid("bot_order").array().default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

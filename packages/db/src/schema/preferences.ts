import { integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";

export const RAIL_MODES = ["expanded", "collapsed"] as const;
export type RailMode = (typeof RAIL_MODES)[number];

export const TIME_FORMATS = ["24h", "12h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const THEMES = [
  "system",
  "light",
  "dark",
  "darcula",
  "darcula-light",
  "catppuccin",
  "tokyonight",
  "onedark",
  "nord",
] as const;
export type Theme = (typeof THEMES)[number];

/** Pixel limits and defaults for the two sidebars. The server clamps to these; the web app drags within them. */
export const SIDEBAR_LIMITS = {
  railWidth: { min: 192, max: 360, fallback: 224 },
  listWidth: { min: 240, max: 560, fallback: 320 },
} as const;

/** How one person arranges the workspace. One row per user; no row means every default. */
export const userPreference = zetta.table("user_preference", {
  ownerUserId: text("owner_user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade", onUpdate: "restrict" }),
  railMode: text("rail_mode", { enum: RAIL_MODES }).default("expanded").notNull(),
  railWidth: integer("rail_width").default(SIDEBAR_LIMITS.railWidth.fallback).notNull(),
  listWidth: integer("list_width").default(SIDEBAR_LIMITS.listWidth.fallback).notNull(),
  /** How the web app shows the hour of day. */
  timeFormat: text("time_format", { enum: TIME_FORMATS }).default("24h").notNull(),
  /** The color theme. Null = the person never chose one on their account: the device keeps its own choice. */
  theme: text("theme", { enum: THEMES }),
  /** The main color, `#rrggbb` in lower case. Null = the theme's own main color. */
  primaryColor: text("primary_color"),
  /** The person's sidebar order of bots (ids, first on top). Only that person reads it; a bot missing from it sorts after, by
   * the server's order, so no foreign key is needed and a deleted bot just drops out. The chief is always first and never listed. */
  botOrder: uuid("bot_order").array().default([]).notNull(),
  /** The person's picture: a preset with colors, or a small uploaded image (data URL). Null = the initial of their name. It lives here and
   * not in `user.image`, because every API request reads the user row. Only the profile API reads and writes it. */
  avatar: jsonb("avatar").$type<
    { kind: "preset"; preset: string; colors: string[] } | { kind: "image"; src: string }
  >(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

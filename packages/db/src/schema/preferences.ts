import { integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";

export const RAIL_MODES = ["expanded", "collapsed"] as const;
export type RailMode = (typeof RAIL_MODES)[number];

/** Which edge of the window the app sidebar sits on. */
/** "simple": the sidebar hides the Advanced group (Studio, Playground, Computer, Agenda). "full": everything. */
export const NAV_MODES = ["simple", "full"] as const;
export type NavMode = (typeof NAV_MODES)[number];
/** A message sent while a bot works: waits for the reply to end ("park"), or interrupts it and is read at once ("interrupt"). */
export const STEER_MODES = ["park", "interrupt"] as const;
export type SteerMode = (typeof STEER_MODES)[number];
export const SIDEBAR_SIDES = ["left", "right"] as const;
export type SidebarSide = (typeof SIDEBAR_SIDES)[number];

export const TIME_FORMATS = ["24h", "12h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** How a person confirms an approval that widens what a bot may do: press and hold the button, or just click it. */
export const APPROVAL_MODES = ["hold", "click"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/**
 * Whether this person's agents may start work. `paused` is the "pause everything" switch: no turn, routine, goal loop, room wake-up or
 * outside message starts, and running turns are stopped. Nothing is lost: routines wait, and everything goes on after `running` returns.
 */
export const AGENTS_STATES = ["running", "paused"] as const;
export type AgentsState = (typeof AGENTS_STATES)[number];

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
  /** The edge of the window the sidebar sits on. */
  sidebarSide: text("sidebar_side", { enum: SIDEBAR_SIDES }).default("left").notNull(),
  navMode: text("nav_mode", { enum: NAV_MODES }).default("full").notNull(),
  steerMode: text("steer_mode", { enum: STEER_MODES }).default("park").notNull(),
  railWidth: integer("rail_width").default(SIDEBAR_LIMITS.railWidth.fallback).notNull(),
  listWidth: integer("list_width").default(SIDEBAR_LIMITS.listWidth.fallback).notNull(),
  /** How the web app shows the hour of day. */
  timeFormat: text("time_format", { enum: TIME_FORMATS }).default("24h").notNull(),
  /** `hold`: an approval that widens a bot's powers needs a press and hold. `click`: one click is enough. The server only labels a card
   * `hold` or `click` by its kind; this choice is the person's, and the web app applies it. */
  approvalMode: text("approval_mode", { enum: APPROVAL_MODES }).default("hold").notNull(),
  /** `paused` stops every agent of this person from starting work (see AGENTS_STATES). */
  agentsState: text("agents_state", { enum: AGENTS_STATES }).default("running").notNull(),
  /** The color theme. Null = the person never chose one on their account: the device keeps its own choice. */
  theme: text("theme", { enum: THEMES }),
  /** The main color, `#rrggbb` in lower case. Null = the theme's own main color. */
  primaryColor: text("primary_color"),
  /** The person's sidebar order of bots (ids, first on top). Only that person reads it; a bot missing from it sorts after, by
   * the server's order, so no foreign key is needed and a deleted bot just drops out. The chief is always first and never listed. */
  botOrder: uuid("bot_order").array().default([]).notNull(),
  /** The person's sidebar order of rooms (ids, first on top). Same rules as `botOrder`: only that person reads it, a room missing
   * from it sorts after by name, and a deleted room just drops out. */
  roomOrder: uuid("room_order").array().default([]).notNull(),
  /** The person's picture: a preset with colors, or a small uploaded image (data URL). Null = the initial of their name. It lives here and
   * not in `user.image`, because every API request reads the user row. Only the profile API reads and writes it. */
  avatar: jsonb("avatar").$type<
    { kind: "preset"; preset: string; colors: string[] } | { kind: "image"; src: string }
  >(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

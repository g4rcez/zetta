import { sql } from "drizzle-orm";
import { check, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DEFAULT_PUSH_MODE, PUSH_MODES } from "@zetta/core/push";
import { zetta } from "./pg-schema";

import { user } from "./auth";

export const RAIL_MODES = ["expanded", "collapsed"] as const;
export type RailMode = (typeof RAIL_MODES)[number];

/** Which edge of the window the app sidebar sits on. */
/** "simple": the sidebar hides the Advanced group (Studio, Playground, Computer, Agenda). "full": everything. */
export const NAV_MODES = ["simple", "full"] as const;
export type NavMode = (typeof NAV_MODES)[number];
/**
 * No longer read. It chose what a message sent while a bot works did: wait for the reply to end ("park") or interrupt it
 * ("interrupt"). Now every such message reaches the bot while it works (docs/decisions/fluid-chat.md). The column stays so that no
 * migration drops what people had set.
 */
export const STEER_MODES = ["park", "interrupt"] as const;
export type SteerMode = (typeof STEER_MODES)[number];
/** Whether a person who joined an installation still has to go through the first-run setup of their own Chief and engine. */
export const MEMBER_ONBOARDING = ["pending", "done"] as const;
export type MemberOnboarding = (typeof MEMBER_ONBOARDING)[number];
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
export const userPreference = zetta.table(
  "user_preference",
  {
    ownerUserId: text("owner_user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade", onUpdate: "restrict" }),
    railMode: text("rail_mode", { enum: RAIL_MODES }).default("expanded").notNull(),
    /** The edge of the window the sidebar sits on. */
    sidebarSide: text("sidebar_side", { enum: SIDEBAR_SIDES }).default("left").notNull(),
    /** New people start `simple`. The migration that changed this default first wrote an explicit `full` row for everyone who had none. */
    navMode: text("nav_mode", { enum: NAV_MODES }).default("simple").notNull(),
    /** New accounts start `pending`: the web app sends them through the onboarding (Chief, engine, instructions) before the app. The migration
     * that added it marked every existing person `done`. The installation admin has their own first-run flow, which also sets `done`. */
    memberOnboarding: text("member_onboarding", { enum: MEMBER_ONBOARDING })
      .default("pending")
      .notNull(),
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
    /** What may wake this person's phone with a push: everything, only a mention or a decision waiting, or nothing (`@zetta/core/push`). */
    pushMode: text("push_mode", { enum: PUSH_MODES }).default(DEFAULT_PUSH_MODE).notNull(),
    /** The color theme. Null = the person never chose one on their account: the device keeps its own choice. */
    theme: text("theme", { enum: THEMES }),
    /** The main color, `#rrggbb` in lower case. Null = the theme's own main color. */
    primaryColor: text("primary_color"),
    /** The person's sidebar order of bots (ids, first on top). Only that person reads it; a bot missing from it sorts after, by
     * the server's order, so no foreign key is needed and a deleted bot just drops out. The chief is always first and never listed. */
    botOrder: uuid("bot_order").array().default([]).notNull(),
    /** The bots the person chose to keep in the chat sidebar (ids, in the order they were pinned). Empty = nothing chosen, and the sidebar
     * lists the few bots it picks by itself. Only that person reads it; like `botOrder` it has no foreign key, so a deleted bot just drops out. */
    sidebarBots: uuid("sidebar_bots").array().default([]).notNull(),
    /** The person's sidebar order of rooms (ids, first on top). Same rules as `botOrder`: only that person reads it, a room missing
     * from it sorts after by name, and a deleted room just drops out. */
    roomOrder: uuid("room_order").array().default([]).notNull(),
    /** The person's picture: a preset with colors, or a small uploaded image (data URL). Null = the initial of their name. It lives here and
     * not in `user.image`, because every API request reads the user row. Only the profile API reads and writes it. */
    avatar: jsonb("avatar").$type<
      { kind: "preset"; preset: string; colors: string[] } | { kind: "image"; src: string }
    >(),
    /** Profile lines the person writes about themselves. Empty = not written. Changed only through `PATCH /api/profile`. */
    jobTitle: text("job_title").default("").notNull(),
    department: text("department").default("").notNull(),
    about: text("about").default("").notNull(),
    /** An IANA time zone name ("America/Sao_Paulo"); the app validates it. Empty = the browser's. */
    timezone: text("timezone").default("").notNull(),
    contact: text("contact").default("").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("user_preference_job_title_check", sql`length(${t.jobTitle}) <= 80`),
    check("user_preference_department_check", sql`length(${t.department}) <= 80`),
    check("user_preference_about_check", sql`length(${t.about}) <= 1000`),
    check("user_preference_timezone_check", sql`length(${t.timezone}) <= 64`),
    check("user_preference_contact_check", sql`length(${t.contact}) <= 200`),
  ],
);

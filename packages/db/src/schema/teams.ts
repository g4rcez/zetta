import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { bot } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const owner = () =>
  text("owner_user_id")
    .notNull()
    .references(() => user.id, restrict);
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const TEAM_KINDS = ["chief", "member"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];
/** Palette names and icon keys for a team role badge. The web app maps them to a Tailwind color and a Phosphor icon. */
export const TEAM_ROLE_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type TeamRoleColor = (typeof TEAM_ROLE_COLORS)[number];
export const TEAM_ROLE_ICONS = [
  "user",
  "magnifying-glass",
  "code",
  "pencil",
  "check-circle",
  "palette",
  "chart-bar",
  "bug",
  "compass",
  "shield",
] as const;
export type TeamRoleIcon = (typeof TEAM_ROLE_ICONS)[number];
export const TEAM_STATUSES = ["active", "archived"] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

/** Where a team group sits on the teams canvas. */
export type TeamBox = { x: number; y: number; w: number; h: number };
/** Where a bot sits inside its team group. */
export type TeamPoint = { x: number; y: number };

/**
 * A group of bots that work together in rooms (a room is a discussion with a `team_id`). The chief gets the user's prompt and
 * coordinates the others. `goal` is the standing goal; without one, the chief pursues the latest prompt.
 */
export const team = pgTable(
  "team",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    goal: text("goal").default("").notNull(),
    /** Shared by every room of the team; each room adds its own context. */
    context: text("context").default("").notNull(),
    canvas: jsonb("canvas").$type<TeamBox>().default({ x: 0, y: 0, w: 360, h: 280 }).notNull(),
    version: integer("version").default(1).notNull(),
    status: text("status", { enum: TEAM_STATUSES }).default("active").notNull(),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("team_owner_name_unique")
      .on(t.ownerUserId, sql`lower(${t.name})`)
      .where(sql`${t.status} = 'active'`),
    check("team_name_check", sql`length(btrim(${t.name})) between 1 and 80`),
    check("team_goal_check", sql`length(${t.goal}) <= 1000`),
    check("team_context_check", sql`length(${t.context}) <= 8000`),
  ],
);

/** What a bot does in a team. The user edits the catalog; deleting a role leaves its members without one. */
export const teamRole = pgTable(
  "team_role",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    color: text("color", { enum: TEAM_ROLE_COLORS }).default("slate").notNull(),
    icon: text("icon", { enum: TEAM_ROLE_ICONS }).default("user").notNull(),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("team_role_owner_name_unique").on(t.ownerUserId, sql`lower(${t.name})`),
    check("team_role_name_check", sql`length(btrim(${t.name})) between 1 and 60`),
    check("team_role_description_check", sql`length(${t.description}) <= 200`),
  ],
);

/** A bot in a team. Exactly one member is the chief. `role` is the old free text: it is kept for one release and no longer read or written. */
export const teamMember = pgTable(
  "team_member",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    kind: text("kind", { enum: TEAM_KINDS }).default("member").notNull(),
    role: text("role").default("").notNull(),
    roleId: uuid("role_id").references(() => teamRole.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
    canvas: jsonb("canvas").$type<TeamPoint>().default({ x: 0, y: 0 }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.botId] }),
    index("team_member_bot_id_idx").on(t.botId),
    uniqueIndex("team_member_one_chief")
      .on(t.teamId)
      .where(sql`${t.kind} = 'chief'`),
    check("team_member_role_check", sql`length(${t.role}) <= 200`),
  ],
);

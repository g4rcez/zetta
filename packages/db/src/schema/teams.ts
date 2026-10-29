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
  ],
);

/** A bot in a team. Exactly one member is the chief. */
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

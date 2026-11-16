import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot } from "./chat";
import { team } from "./teams";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;

/** "archived" hides the project; its tasks, rooms and memory stay. A project is never deleted. */
export const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** How soon the manager hears about work that stopped moving: "close" halves the waiting times, "light" doubles them and asks nobody. */
export const PROJECT_WATCH = ["close", "normal", "light"] as const;
export type ProjectWatch = (typeof PROJECT_WATCH)[number];

export const PROJECT_MEMBER_KINDS = ["bot", "person"] as const;
export type ProjectMemberKind = (typeof PROJECT_MEMBER_KINDS)[number];

/** The four answers of the brief, in the order the form asks them. */
export const PROJECT_BRIEF_FIELDS = ["outcome", "audience", "doneWhen", "notIncluded"] as const;
export type ProjectBriefField = (typeof PROJECT_BRIEF_FIELDS)[number];
export const PROJECT_BRIEF_MAX = 1000;

/**
 * Work a manager follows as one thing: tasks, rooms, bots and people that share a brief. The brief is four short answers instead of one
 * free text: what should exist at the end, who it is for, how we know it is done and what is not included.
 */
export const project = zetta.table(
  "project",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    name: text("name").notNull(),
    outcome: text("outcome").default("").notNull(),
    audience: text("audience").default("").notNull(),
    doneWhen: text("done_when").default("").notNull(),
    notIncluded: text("not_included").default("").notNull(),
    labels: text("labels")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    status: text("status", { enum: PROJECT_STATUSES }).default("active").notNull(),
    watch: text("watch", { enum: PROJECT_WATCH }).default("normal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("project_owner_idx").on(t.ownerUserId, t.status),
    uniqueIndex("project_owner_name_unique")
      .on(t.ownerUserId, sql`lower(${t.name})`)
      .where(sql`${t.status} <> 'archived'`),
    check("project_name_check", sql`length(btrim(${t.name})) between 1 and 120`),
    check(
      "project_brief_check",
      sql`length(${t.outcome}) <= 1000 and length(${t.audience}) <= 1000 and length(${t.doneWhen}) <= 1000 and length(${t.notIncluded}) <= 1000`,
    ),
  ],
);

/**
 * Who works on a project. A bot gets the brief and the project memory in its context. A person reads the project page; `teamId` is the team
 * of the owner through which they were added, and they count only while they are still a live person of that team.
 */
export const projectMember = zetta.table(
  "project_member",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, cascade),
    kind: text("kind", { enum: PROJECT_MEMBER_KINDS }).notNull(),
    botId: uuid("bot_id").references(() => bot.id, cascade),
    userId: text("user_id").references(() => user.id, restrict),
    teamId: uuid("team_id").references(() => team.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("project_member_bot_unique")
      .on(t.projectId, t.botId)
      .where(sql`${t.kind} = 'bot'`),
    uniqueIndex("project_member_person_unique")
      .on(t.projectId, t.userId)
      .where(sql`${t.kind} = 'person'`),
    index("project_member_bot_id_idx").on(t.botId),
    index("project_member_user_id_idx").on(t.userId),
    index("project_member_team_id_idx").on(t.teamId),
    check(
      "project_member_kind_check",
      sql`(${t.kind} = 'bot' and ${t.botId} is not null and ${t.userId} is null and ${t.teamId} is null) or (${t.kind} = 'person' and ${t.userId} is not null and ${t.teamId} is not null and ${t.botId} is null)`,
    ),
  ],
);

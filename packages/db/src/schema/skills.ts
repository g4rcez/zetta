import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;

export const SKILL_SOURCES = ["manual", "github"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];
/** Delete = archive: an archived skill leaves every bot's run and frees its name, the row stays. */
export const SKILL_STATUSES = ["active", "archived"] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

/**
 * A skill in a person's library (modules/skills). Bots keep a live reference (`bot_skill`), so an edit reaches every bot that uses it.
 * Only the SKILL.md text is kept. `source_ref` is the commit a GitHub skill was installed from.
 */
export const skill = zetta.table(
  "skill",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    source: text("source", { enum: SKILL_SOURCES }).default("manual").notNull(),
    sourceRepo: text("source_repo"),
    sourcePath: text("source_path"),
    sourceRef: text("source_ref"),
    version: integer("version").default(1).notNull(),
    status: text("status", { enum: SKILL_STATUSES }).default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("skill_owner_name_active")
      .on(t.ownerUserId, t.name)
      .where(sql`${t.status} = 'active'`),
    index("skill_owner_idx").on(t.ownerUserId),
    check("skill_name_check", sql`${t.name} ~ '^[a-z][a-z0-9-]*$' and length(${t.name}) <= 63`),
    check("skill_description_check", sql`length(${t.description}) <= 600`),
  ],
);

/** A library skill a bot brings to its harness. */
export const botSkill = zetta.table(
  "bot_skill",
  {
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.skillId] }),
    index("bot_skill_skill_idx").on(t.skillId),
  ],
);

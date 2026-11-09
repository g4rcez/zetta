import { sql } from "drizzle-orm";
import {
  bytea,
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

/** `pending`: a GitHub skill installed before its folder was kept; the server downloads the other files at the pinned commit. */
/**
 * `pristine`: the text is what was installed from GitHub (or the skill was written here). `edited`: the owner changed an installed skill,
 * so an update from GitHub would overwrite their work and asks first.
 */
export const SKILL_SOURCE_STATES = ["pristine", "edited"] as const;
export type SkillSourceState = (typeof SKILL_SOURCE_STATES)[number];

export const SKILL_FILES_STATUSES = ["complete", "pending"] as const;
export type SkillFilesStatus = (typeof SKILL_FILES_STATUSES)[number];
export const SKILL_FILE_MODES = ["file", "executable"] as const;
export type SkillFileMode = (typeof SKILL_FILE_MODES)[number];

/**
 * A skill in a person's library (modules/skills). Bots keep a live reference (`bot_skill`), so an edit reaches every bot that uses it.
 * The SKILL.md text is `body`; the other files of the skill folder are rows of `skill_file`. `source_ref` is the commit a GitHub skill was installed from.
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
    sourceState: text("source_state", { enum: SKILL_SOURCE_STATES }).default("pristine").notNull(),
    status: text("status", { enum: SKILL_STATUSES }).default("active").notNull(),
    filesStatus: text("files_status", { enum: SKILL_FILES_STATUSES }).default("complete").notNull(),
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

/** A file of a skill's folder next to its SKILL.md (scripts, references, assets). `path` is relative to the folder. */
export const skillFile = zetta.table(
  "skill_file",
  {
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, restrict),
    path: text("path").notNull(),
    content: bytea("content").notNull(),
    mode: text("mode", { enum: SKILL_FILE_MODES }).default("file").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.skillId, t.path] }),
    check(
      "skill_file_path_check",
      sql`${t.path} <> 'SKILL.md' and ${t.path} !~ '^/' and ${t.path} !~ '(^|/)\\.\\.(/|$)' and length(${t.path}) <= 300`,
    ),
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

/**
 * One time a library skill was used: picked with `/` in the chat, or loaded by a Claude Code run. Pruned after 90 days. It only feeds the
 * library page ("used 12 times, last 2 days ago", the Unused filter); nothing depends on it to run a bot.
 */
export const SKILL_USE_SOURCES = ["picked", "run"] as const;
export type SkillUseSource = (typeof SKILL_USE_SOURCES)[number];
export const skillUse = zetta.table(
  "skill_use",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    source: text("source", { enum: SKILL_USE_SOURCES }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("skill_use_skill_idx").on(t.skillId, t.usedAt),
    index("skill_use_bot_idx").on(t.botId),
  ],
);

/**
 * What a skill looked like after one save (create, edit, restore, update from GitHub). Immutable. The page lists them with a diff and
 * brings one back; only the last 50 are kept. `files_hash` says whether the folder changed without keeping the files.
 */
export const skillRevision = zetta.table(
  "skill_revision",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, restrict),
    /** The skill's `version` after this save. */
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    filesHash: text("files_hash").default("").notNull(),
    savedByUserId: text("saved_by_user_id")
      .notNull()
      .references(() => user.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("skill_revision_skill_version_idx").on(t.skillId, t.version),
    index("skill_revision_skill_idx").on(t.skillId, t.createdAt),
  ],
);

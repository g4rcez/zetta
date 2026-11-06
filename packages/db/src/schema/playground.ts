import { sql } from "drizzle-orm";
import {
  bytea,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

export const PLAYGROUND_LANGUAGES = ["typescript", "javascript", "python", "bash", "html"] as const;
export type PlaygroundLanguage = (typeof PLAYGROUND_LANGUAGES)[number];
/** `host`: the server runs the CLI. `container`: a long-lived Docker or Podman container per language. `browser`: the page runs it in a sandboxed iframe. */
export const PLAYGROUND_RUNNERS = ["host", "container", "browser"] as const;
export type PlaygroundRunner = (typeof PLAYGROUND_RUNNERS)[number];
/** `team`: every member reads, runs and forks. Only the owner edits. */
export const PLAYGROUND_VISIBILITIES = ["private", "team"] as const;
export type PlaygroundVisibility = (typeof PLAYGROUND_VISIBILITIES)[number];
/** Delete = archive: an archived playground leaves every list, the row and its runs stay. */
export const PLAYGROUND_STATUSES = ["active", "archived"] as const;
export type PlaygroundStatus = (typeof PLAYGROUND_STATUSES)[number];
export const PLAYGROUND_RUN_STATUSES = [
  "running",
  "ok",
  "failed",
  "timeout",
  "cancelled",
  "interrupted",
] as const;
export type PlaygroundRunStatus = (typeof PLAYGROUND_RUN_STATUSES)[number];
/** `truncated`: stdout or stderr was cut to its tail, or `out/` files were dropped for size. */
export const PLAYGROUND_RUN_OUTPUTS = ["complete", "truncated"] as const;
export type PlaygroundRunOutput = (typeof PLAYGROUND_RUN_OUTPUTS)[number];
export const PLAYGROUND_INPUT_TYPES = ["string", "number", "boolean", "json"] as const;
export type PlaygroundInputType = (typeof PLAYGROUND_INPUT_TYPES)[number];

/** A declared input. A run gets the values as `inputs.json` in its folder and as `ZETTA_INPUTS` (JSON); a browser run gets `window.ZETTA_INPUTS`. */
export type PlaygroundInputSpec = {
  name: string;
  label?: string;
  type: PlaygroundInputType;
  default?: unknown;
};
/** The files of a run, copied when it starts, so the history shows what each run used. */
export type PlaygroundFileSnapshot = { path: string; content: string };

/**
 * A saved piece of code that bots and people run (modules/playground): files, declared inputs and a run history.
 * The first part of Zetta Apps. `createdByBotId` and `conversationId` say where a bot made it.
 */
export const playground = zetta.table(
  "playground",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    title: text("title").notNull(),
    language: text("language", { enum: PLAYGROUND_LANGUAGES }).notNull(),
    runner: text("runner", { enum: PLAYGROUND_RUNNERS }).default("host").notNull(),
    entry: text("entry").notNull(),
    inputs: jsonb("inputs").$type<PlaygroundInputSpec[]>().default([]).notNull(),
    visibility: text("visibility", { enum: PLAYGROUND_VISIBILITIES }).default("private").notNull(),
    status: text("status", { enum: PLAYGROUND_STATUSES }).default("active").notNull(),
    createdByBotId: uuid("created_by_bot_id").references(() => bot.id, setNull),
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("playground_owner_idx").on(t.ownerUserId),
    check("playground_title_check", sql`length(btrim(${t.title})) between 1 and 120`),
    check("playground_entry_check", sql`length(${t.entry}) between 1 and 300`),
  ],
);

/** A file of a playground. `path` is relative to the run folder. */
export const playgroundFile = zetta.table(
  "playground_file",
  {
    playgroundId: uuid("playground_id")
      .notNull()
      .references(() => playground.id, restrict),
    path: text("path").notNull(),
    content: text("content").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playgroundId, t.path] }),
    check(
      "playground_file_path_check",
      sql`${t.path} !~ '^/' and ${t.path} !~ '(^|/)\\.\\.(/|$)' and ${t.path} !~ '^out(/|$)' and length(${t.path}) between 1 and 300`,
    ),
  ],
);

/** One run: a snapshot of the files and inputs it used, and what came out. The app keeps the last 20 runs of a playground. */
export const playgroundRun = zetta.table(
  "playground_run",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    playgroundId: uuid("playground_id")
      .notNull()
      .references(() => playground.id, restrict),
    /** Who pressed Run, or the human a bot acts for. Not always the owner of a team playground. */
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    runner: text("runner", { enum: PLAYGROUND_RUNNERS }).notNull(),
    status: text("status", { enum: PLAYGROUND_RUN_STATUSES }).default("running").notNull(),
    /** The output of the CLI's version flag, for example `1.3.14`. Empty for a browser run. */
    runtimeVersion: text("runtime_version").default("").notNull(),
    entry: text("entry").notNull(),
    files: jsonb("files").$type<PlaygroundFileSnapshot[]>().notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().default({}).notNull(),
    exitCode: integer("exit_code"),
    stdout: text("stdout").default("").notNull(),
    stderr: text("stderr").default("").notNull(),
    output: text("output", { enum: PLAYGROUND_RUN_OUTPUTS }).default("complete").notNull(),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("playground_run_playground_idx").on(t.playgroundId, t.startedAt)],
);

/** A file the script wrote to `out/`, kept with its run. */
export const playgroundRunOutput = zetta.table(
  "playground_run_output",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => playgroundRun.id, restrict),
    path: text("path").notNull(),
    content: bytea("content").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.path] }),
    check(
      "playground_run_output_path_check",
      sql`${t.path} !~ '^/' and ${t.path} !~ '(^|/)\\.\\.(/|$)' and length(${t.path}) between 1 and 300`,
    ),
  ],
);

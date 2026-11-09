import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation } from "./chat";
import { configProposal } from "./features";
import { playground } from "./playground";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

/** `team`: every member may call the app's tools, with their own accounts. Only the owner publishes and changes it. */
export const APP_VISIBILITIES = ["private", "team"] as const;
export type AppVisibility = (typeof APP_VISIBILITIES)[number];
/** Delete = archive: an archived app leaves every list and frees its slug; the rows and the call history stay. */
export const APP_STATUSES = ["active", "archived"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];
/** `query` only reads; `mutation` may change something. The kind belongs to the tool, not to its name. */
export const APP_TOOL_KINDS = ["query", "mutation"] as const;
export type AppToolKind = (typeof APP_TOOL_KINDS)[number];
/** The owner's choice for a tool: `ask` = a card before every call, `auto` = no card, `block` = never. It beats what the tool declares. */
export const APP_TOOL_POLICIES = ["ask", "auto", "block"] as const;
export type AppToolPolicy = (typeof APP_TOOL_POLICIES)[number];
export const APP_CALL_SOURCES = ["bot", "routine", "workflow", "mcp", "ui", "code"] as const;
export type AppCallSource = (typeof APP_CALL_SOURCES)[number];
export const APP_CALL_STATUSES = [
  "pending_approval",
  "running",
  "ok",
  "failed",
  "denied",
  "expired",
] as const;
export type AppCallStatus = (typeof APP_CALL_STATUSES)[number];

/** A condition on a tool's input that makes a call need approval (`approval: { when: [...] }`). All conditions must hold. */
export type AppApprovalCondition = {
  /** Dotted path into the input, for example `repo.private`. */
  path: string;
  op: "eq" | "neq" | "gt" | "lt" | "contains" | "exists";
  value?: unknown;
};
/** What a tool declares about approval. `never` and `always` are plain; `when` asks only when the input matches. */
export type AppApproval = "always" | "never" | { when: AppApprovalCondition[] };
/** A JSON Schema as the SDK writes it (a small subset, see modules/apps/schema.ts). */
export type AppJsonSchema = Record<string, unknown>;
export type AppToolManifest = {
  /** Dotted, for example `issues.list`. */
  name: string;
  kind: AppToolKind;
  description: string;
  input: AppJsonSchema;
  output?: AppJsonSchema;
  approval?: AppApproval;
  /** Names of the accounts (from the manifest's `accounts`) the tool uses. */
  accounts: string[];
  /**
   * The collections the tool reads. `collections` hold one set of records per caller; `shared` ones hold one set for everyone who may call
   * the app. `write` lets a mutation change them (a query never writes).
   */
  storage?: { collections: string[]; shared: string[]; write: boolean };
};
export type AppAccountManifest = {
  label: string;
  /** `user`: each caller links their own account. `app`: one account the owner links for everyone. */
  scope: "user" | "app";
  auth: "api_key" | "oauth2";
  /** The fields a person types for an `api_key` account. */
  fields?: { key: string; label: string; secret: boolean }[];
};
/** What the SDK prints when the app runs in `describe` mode. Stored on the version, so a call never has to run the code to learn its tools. */
export type AppManifest = {
  sdk: number;
  tools: AppToolManifest[];
  accounts: Record<string, AppAccountManifest>;
  /** The page of the app, when it has one: the file it was built from and the size of the built page. */
  ui?: { entry: string; bytes: number };
};
export type AppFileSnapshot = { path: string; content: string };
/** Per-app choices of the owner. `runner` is the one the app was published from; a call runs in it. */
export type AppSettings = {
  toolPolicy?: Record<string, AppToolPolicy>;
  runner?: "host" | "container";
};

/**
 * An app: published code that bots, routines and workflows call as typed tools (modules/apps). The code is edited in a playground and
 * published as an immutable version; `activeVersionId` says which one answers calls, so a rollback is a change of that pointer.
 */
export const app = zetta.table(
  "app",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    /** The name in tool paths (`apps.<slug>.<tool>`). Unique among a person's active apps. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    visibility: text("visibility", { enum: APP_VISIBILITIES }).default("private").notNull(),
    status: text("status", { enum: APP_STATUSES }).default("active").notNull(),
    /** The playground whose files are published; editing there changes nothing until the next publish. */
    sourcePlaygroundId: uuid("source_playground_id").references(() => playground.id, setNull),
    activeVersionId: uuid("active_version_id").references(
      (): AnyPgColumn => appVersion.id,
      setNull,
    ),
    settings: jsonb("settings").$type<AppSettings>().default({}).notNull(),
    /** Optimistic lock for changes to the app row. */
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("app_owner_slug_active_idx")
      .on(t.ownerUserId, t.slug)
      .where(sql`${t.status} = 'active'`),
    index("app_owner_idx").on(t.ownerUserId),
    check("app_slug_check", sql`${t.slug} ~ '^[a-z][a-z0-9-]{0,39}$'`),
    check("app_name_check", sql`length(btrim(${t.name})) between 1 and 120`),
  ],
);

/** One published version: the files that run and the tools they declare. Never changed after it is written. */
export const appVersion = zetta.table(
  "app_version",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, restrict),
    /** 1, 2, 3... per app. */
    n: integer("n").notNull(),
    entry: text("entry").notNull(),
    files: jsonb("files").$type<AppFileSnapshot[]>().notNull(),
    manifest: jsonb("manifest").$type<AppManifest>().notNull(),
    /** The page of the app, built at publish time into one self-contained HTML (null: the app has tools only). */
    ui: text("ui"),
    /** The file `ui` was built from, for example `ui/index.html`. */
    uiEntry: text("ui_entry"),
    note: text("note").default("").notNull(),
    publishedByUserId: text("published_by_user_id")
      .notNull()
      .references(() => user.id, restrict),
    /** Set when a bot asked for the publish; the person approved it. */
    publishedByBotId: uuid("published_by_bot_id").references(() => bot.id, setNull),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("app_version_app_n_idx").on(t.appId, t.n),
    check("app_version_note_check", sql`length(${t.note}) <= 500`),
  ],
);

/** The apps a bot may use, like `bot_skill` for skills. Granted by the person who owns the bot. */
export const botApp = zetta.table(
  "bot_app",
  {
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.appId] }), index("bot_app_app_idx").on(t.appId)],
);

/**
 * Every call of an app's tool, from any source. A call that needs approval waits here as `pending_approval` next to its card
 * (`proposalId`); the result is kept here too, so a caller with no chat (a routine, the outward gateway) can read it.
 * Input and result are cut to a size limit before they are stored.
 */
export const appCall = zetta.table(
  "app_call",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, restrict),
    versionId: uuid("version_id")
      .notNull()
      .references(() => appVersion.id, restrict),
    tool: text("tool").notNull(),
    kind: text("kind", { enum: APP_TOOL_KINDS }).notNull(),
    /** Who the call acts for: their accounts are used. */
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    source: text("source", { enum: APP_CALL_SOURCES }).notNull(),
    status: text("status", { enum: APP_CALL_STATUSES }).notNull(),
    input: jsonb("input").$type<unknown>().notNull(),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    proposalId: uuid("proposal_id").references(() => configProposal.id, setNull),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("app_call_app_idx").on(t.appId, t.createdAt),
    index("app_call_actor_idx").on(t.actorUserId, t.createdAt),
    index("app_call_proposal_idx").on(t.proposalId),
  ],
);

/**
 * What an app keeps (modules/apps storage). A record belongs to one person (`userId`) or, in a shared collection, to the whole app
 * (`userId` null). Tools get a snapshot with the call and their writes are applied after a valid result, in one transaction.
 * A rollback of a version never touches these rows.
 */
export const appRecord = zetta.table(
  "app_record",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, restrict),
    /** The person the record belongs to; null in a shared collection. */
    userId: text("user_id").references(() => user.id, restrict),
    collection: text("collection").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    /** Size of the value as JSON text, so quotas need no scan of the values. */
    bytes: integer("bytes").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("app_record_key_idx").on(
      t.appId,
      sql`coalesce(${t.userId}, '')`,
      t.collection,
      t.key,
    ),
    index("app_record_user_idx").on(t.appId, t.userId, t.collection),
    check("app_record_collection_check", sql`${t.collection} ~ '^[a-z][a-z0-9_-]{0,39}$'`),
    check("app_record_key_check", sql`length(${t.key}) between 1 and 200`),
  ],
);

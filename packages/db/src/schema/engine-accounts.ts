import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACCOUNT_ENGINES,
  ACCOUNT_KINDS,
  ACCOUNT_LABEL_MAX,
  ACCOUNT_STATES,
  ACCOUNT_USES,
} from "@zetta/core/engine-accounts";
import { zetta } from "./pg-schema";
import { inWorkspace } from "./workspace-table";

import { user } from "./auth";
import { bot } from "./chat";
import { connection } from "./connections";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const stamp = (name: string) => timestamp(name, { withTimezone: true }).defaultNow().notNull();

/**
 * One account a person connected to one engine (@zetta/core/engine-accounts). A `token` or an `api_key` keeps its secret as a sealed
 * connection (`connection_id`); a `login` keeps the CLI's own sign-in in a folder named after `id`, and holds no secret here. The row
 * never holds a secret. One `default` per person and engine among the active ones.
 */
export const engineAccount = zetta.table(
  "engine_account",
  {
    workspaceId: inWorkspace(),
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    engine: text("engine", { enum: ACCOUNT_ENGINES }).notNull(),
    kind: text("kind", { enum: ACCOUNT_KINDS }).notNull(),
    /** For a key: whose key it is (`anthropic`, `openai`...). For a sign-in of a CLI that speaks to several providers: which one. */
    provider: text("provider"),
    label: text("label").notNull(),
    use: text("use", { enum: ACCOUNT_USES }).default("default").notNull(),
    state: text("state", { enum: ACCOUNT_STATES }).notNull(),
    connectionId: uuid("connection_id").references(() => connection.id, {
      onDelete: "cascade",
      onUpdate: "restrict",
    }),
    /** When the CLI was last asked whether a `login` still holds. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (t) => [
    index("engine_account_owner_idx").on(t.ownerUserId, t.engine),
    index("engine_account_connection_id_idx").on(t.connectionId),
    uniqueIndex("engine_account_one_default")
      .on(t.workspaceId, t.ownerUserId, t.engine)
      .where(sql`${t.use} = 'default' and ${t.state} = 'active'`),
    // One account for the whole workspace per engine.
    uniqueIndex("engine_account_one_workspace")
      .on(t.workspaceId, t.engine)
      .where(sql`${t.use} = 'workspace' and ${t.state} = 'active'`),
    check("engine_account_kind_check", sql`${t.kind} in ('login', 'token', 'api_key')`),
    check("engine_account_state_check", sql`${t.state} in ('pending', 'active', 'signed_out')`),
    check("engine_account_use_check", sql`${t.use} in ('default', 'extra', 'workspace')`),
    check(
      "engine_account_label_check",
      sql`length(${t.label}) between 1 and ${sql.raw(String(ACCOUNT_LABEL_MAX))}`,
    ),
    // An active token or key always has its sealed secret; a sign-in never has one.
    check(
      "engine_account_secret_check",
      sql`(${t.kind} = 'login' and ${t.connectionId} is null) or (${t.kind} <> 'login' and (${t.state} <> 'active' or ${t.connectionId} is not null))`,
    ),
  ],
);

/**
 * What one person chose for one bot: the engine, the model and which of their accounts runs it. An empty column follows the bot's own
 * choice (its owner's), and an empty account follows the person's default account for the engine.
 */
export const botEngine = zetta.table(
  "bot_engine",
  {
    workspaceId: inWorkspace(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, { onDelete: "cascade", onUpdate: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, restrict),
    harness: text("harness", { enum: ACCOUNT_ENGINES }),
    model: text("model"),
    accountId: uuid("account_id").references(() => engineAccount.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
    updatedAt: stamp("updated_at"),
  },
  (t) => [
    foreignKey({
      name: "bot_engine_bot_id_workspace_fkey",
      columns: [t.botId, t.workspaceId],
      foreignColumns: [bot.id, bot.workspaceId],
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    primaryKey({ name: "bot_engine_pkey", columns: [t.botId, t.userId] }),
    index("bot_engine_user_id_idx").on(t.userId),
    index("bot_engine_account_id_idx").on(t.accountId),
  ],
);

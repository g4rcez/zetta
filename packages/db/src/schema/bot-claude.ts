import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { bot } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;

/**
 * How one bot runs Claude Code (modules/bot-claude): permission preset, extra allow/deny rules, an appended system prompt, effort and a
 * per-run budget. One row per bot; no row means the defaults, so existing bots keep behaving as before.
 */
export const botClaudeConfig = zetta.table("bot_claude_config", {
  botId: uuid("bot_id")
    .primaryKey()
    .references(() => bot.id, restrict),
  // auto = today's behaviour (git on the host, any command inside the container). The others narrow or fix it.
  preset: text("preset", { enum: ["auto", "read_only", "edit", "git", "full"] })
    .default("auto")
    .notNull(),
  allow: jsonb("allow").$type<string[]>().default([]).notNull(),
  deny: jsonb("deny").$type<string[]>().default([]).notNull(),
  appendPrompt: text("append_prompt").default("").notNull(),
  effort: text("effort", { enum: ["low", "medium", "high", "xhigh", "max"] }),
  maxBudgetCents: integer("max_budget_cents"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** A skill or sub-agent installed for exactly one bot. Written to a throwaway plugin directory for each run; never shared between bots. */
export const botClaudeAsset = zetta.table(
  "bot_claude_asset",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    kind: text("kind", { enum: ["skill", "agent"] }).notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    // Agents only: tools the sub-agent may use (empty = inherit) and its model.
    tools: jsonb("tools").$type<string[]>().default([]).notNull(),
    model: text("model", { enum: ["inherit", "sonnet", "opus", "haiku"] }),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("bot_claude_asset_unique").on(table.botId, table.kind, table.name),
    check(
      "bot_claude_asset_name_check",
      sql`${table.name} ~ '^[a-z][a-z0-9-]*$' and length(${table.name}) <= 63`,
    ),
  ],
);

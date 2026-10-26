import { PluginError, registerPlugin, type PluginContext, type PluginDef, type PluginTool } from "../integrations/plugins/registry";
import { str, untrustedList } from "../integrations/plugins/untrusted";
import type { BotDatabase } from "./service";
import { TEMPLATES } from "./templates";

/**
 * Bot database: a built-in plugin every bot has. Each bot owns one private Postgres schema (`<slug>_bot`) and decides its own tables:
 * tasks, preferences, notes, options for its job. People never write SQL; they see the tables, in their own words, in the bot's settings.
 */
let service: BotDatabase | undefined;
/** Called once at startup (services.ts). Without it every tool reports NOT_CONFIGURED. */
export const configureBotDatabase = (s: BotDatabase | undefined) => { service = s; };

const need = (ctx: PluginContext) => {
  if (!service) throw new PluginError("NOT_CONFIGURED", "Bot databases are not set up on this server.", "Ask the administrator to set ZETTA_CONNECTION_KEY (or ZETTA_BOT_DATABASE_KEY).");
  if (!ctx.botId) throw new PluginError("INVALID_ARGS", "No bot was given.");
  return { db: service, botId: ctx.botId };
};
const sqlArg = (v: unknown) => { const s = str(v, 20_000); if (!s) throw new PluginError("INVALID_ARGS", "The database command is empty."); return s; };
const paramsArg = (v: unknown) => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > 100) throw new PluginError("INVALID_ARGS", "params must be a list of at most 100 values.");
  return v.map((x) => (x === null || ["string", "number", "boolean"].includes(typeof x) ? x : JSON.stringify(x)));
};
const SQL = { sql: { type: "string", description: "One PostgreSQL statement. Use $1, $2... for values." }, params: { type: "array", description: "Values for $1, $2... (never paste user text into the SQL itself)." } };
const SRC = "your bot database (rows may contain text from users or outside people)";

const tools: PluginTool[] = [
  {
    name: "db_overview", effect: "read",
    description: "Your tables, their descriptions and columns, row counts and space used. Call it before creating or changing tables.",
    inputSchema: { type: "object", properties: {} },
    async handler(ctx) {
      const { db, botId } = need(ctx); const o = await db.overview(botId);
      const tables = o.tables.map((t) => ({ name: t.name, description: t.description, rows: t.rows, columns: t.columns.map((c) => `${c.name} ${c.type}${c.nullable ? "" : " not null"}${c.description ? ` -- ${c.description}` : ""}`) }));
      return untrustedList(SRC, "tables", tables, { schema: o.schema, usedMb: +(o.usedBytes / 1048576).toFixed(2), quotaMb: Math.round(o.quotaBytes / 1048576), templates: TEMPLATES.map((t) => `${t.id}${o.templates.includes(t.id) ? " (applied)" : ""}`) });
    },
  },
  {
    name: "db_query", effect: "read",
    description: "Read data with one SELECT (read-only; at most 200 rows come back).",
    inputSchema: { type: "object", properties: SQL, required: ["sql"] },
    async handler(ctx, a) {
      const { db, botId } = need(ctx); const r = await db.query(botId, sqlArg(a.sql), paramsArg(a.params));
      return untrustedList(SRC, "rows", r.rows, { columns: r.columns, ...(r.truncated ? { note: "more than 200 rows: narrow the query or add LIMIT/OFFSET" } : {}) });
    },
  },
  {
    name: "db_execute",
    description: "Change your database: CREATE/ALTER/DROP TABLE, INSERT, UPDATE, DELETE, COMMENT ON. Several statements may be sent together when params are not used.",
    inputSchema: { type: "object", properties: SQL, required: ["sql"] },
    async handler(ctx, a) {
      const { db, botId } = need(ctx);
      return untrustedList(SRC, "results", await db.execute(botId, sqlArg(a.sql), paramsArg(a.params)));
    },
  },
  {
    name: "db_apply_template",
    description: `Add a ready-made table: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}. Safe to apply twice.`,
    inputSchema: { type: "object", properties: { template: { type: "string", enum: TEMPLATES.map((t) => t.id) } }, required: ["template"] },
    async handler(ctx, a) { const { db, botId } = need(ctx); const r = await db.applyTemplate(botId, str(a.template, 40)); return `Added the ${r.title} table.`; },
  },
];

export const botDatabasePlugin: PluginDef = {
  id: "postgres", name: "Bot database", icon: "database", category: "productivity", kind: "native", auth: "none", fields: [],
  description: "Your own private PostgreSQL database for anything you need to keep between conversations: tasks, preferences, options, notes, lists. "
    + "Check db_overview first and reuse existing tables; keep tables simple (an id and created_at); after creating a table or column, always "
    + "COMMENT ON it in the user's language (tables as 'Short title: one sentence on what it keeps', columns as a short label), because that is what people see in your settings. Do the SQL yourself; never ask the user to write it. "
    + "Do not store passwords or secrets. Use `remember` for short facts about the user and this database for structured data.",
  notes: "Built in: every bot gets its own private space, which only that bot can read or change. See and export what it saved, or start over, in the bot's settings > Database.",
  tools,
  always: {
    async available(botId) { return Boolean(service) && await service!.available() && await service!.access(botId); },
    async prompt(botId) {
      const schema = await service!.ensure(botId);
      return `Your schema is ${schema} (already your search_path: write plain table names). It belongs to you and everyone who talks to you shares it: store who an entry is about when that matters, and never show one person's private entries to someone else.`;
    },
  },
};
registerPlugin(botDatabasePlugin);

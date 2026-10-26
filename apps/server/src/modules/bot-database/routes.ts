import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { Elysia } from "elysia";
import { z } from "zod";
import { audit } from "../features/audit";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import { PluginError } from "../integrations/plugins/registry";
import type { BotDatabase } from "./service";
import { TEMPLATES } from "./templates";

export type BotDatabaseServices = { access: ReturnType<typeof createIdentityAccess>; db: Database; database?: BotDatabase };
const uuid = z.string().uuid();
const tableName = z.string().min(1).max(63);
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string, fix?: string) => out({ error: { code, message, ...(fix ? { fix } : {}) } }, status);
const download = (body: string, type: string, name: string) => new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });

/** The Database tab of a bot's settings: only the bot's owner may look at, export or erase what it saved. */
export function createBotDatabaseRoutes({ access, db, database }: BotDatabaseServices, trustedOrigins: readonly string[]) {
  type Ctx = { actor: ActiveActor; body: unknown; params: Record<string, string>; query: Record<string, string | undefined> };
  async function owned(actor: ActiveActor, id: string) {
    const [row] = await db.select({ id: bot.id, slug: bot.slug }).from(bot).where(and(eq(bot.id, uuid.parse(id)), eq(bot.ownerUserId, actor.userId), eq(bot.archived, false)));
    if (!row) throw new AccessError("NOT_FOUND");
    if (!database) throw new PluginError("NOT_CONFIGURED", "Bot databases are not set up on this server.", "Ask the administrator to set ZETTA_CONNECTION_KEY (or ZETTA_BOT_DATABASE_KEY).");
    return { ...row, database };
  }
  function mapError(e: unknown) {
    if (e instanceof AccessError) return fail(e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "NOT_FOUND" ? 404 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403, e.code, e.message);
    if (e instanceof PluginError) return fail(e.code === "NOT_CONFIGURED" ? 503 : e.code === "DB_NOT_FOUND" || e.code === "NOT_FOUND" ? 404 : e.code === "TIMEOUT" ? 504 : e.code === "QUOTA" ? 507 : e.code === "FAILED" || e.code === "UNREACHABLE" ? 502 : 400, e.code, e.safe, e.fix);
    if (e instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    console.error(`bot database: unhandled error name=${(e as Error | undefined)?.name ?? typeof e}`);
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = (work: (c: Ctx) => Promise<unknown>) => async ({ request, body, params, query }: { request: Request; body: unknown; params: Record<string, string>; query: Record<string, string | undefined> }) => {
    try {
      if (request.method !== "GET") { const o = request.headers.get("origin"); if (!o || !trustedOrigins.includes(o)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again."); }
      const r = await work({ actor: await access.requireActive(request.headers), body, params, query });
      return r instanceof Response ? r : out(r);
    } catch (e) { return mapError(e); }
  };
  const done = (actor: ActiveActor, botId: string, detail: string) => audit(db, actor.userId, { kind: "tool_call", botId, outcome: "ok", detail });

  return new Elysia({ prefix: "/api", normalize: false })
    .get("/bot-database/templates", g(async () => ({ templates: TEMPLATES.map(({ id, title, description }) => ({ id, title, description })) })))
    .get("/bots/:id/database", g(async (c) => { const b = await owned(c.actor, c.params.id!); return { database: await b.database.overview(b.id) }; }))
    .get("/bots/:id/database/tables/:table", g(async (c) => {
      const b = await owned(c.actor, c.params.id!);
      const page = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(c.query);
      return b.database.rows(b.id, tableName.parse(c.params.table), page.offset, page.limit);
    }))
    .get("/bots/:id/database/export.json", g(async (c) => {
      const b = await owned(c.actor, c.params.id!); const data = await b.database.exportJson(b.id); await done(c.actor, b.id, "bot-db:export");
      return download(JSON.stringify(data, null, 2), "application/json", `${b.slug}-database.json`);
    }))
    .get("/bots/:id/database/tables/:table/export.csv", g(async (c) => {
      const b = await owned(c.actor, c.params.id!); const r = await b.database.exportCsv(b.id, tableName.parse(c.params.table)); await done(c.actor, b.id, "bot-db:export");
      return download(r.csv, "text/csv; charset=utf-8", `${b.slug}-${r.name.replace(/[^A-Za-z0-9_-]/g, "_")}.csv`);
    }))
    .post("/bots/:id/database/templates/:template", g(async (c) => {
      const b = await owned(c.actor, c.params.id!); const r = await b.database.applyTemplate(b.id, z.string().max(40).parse(c.params.template)); await done(c.actor, b.id, "bot-db:template");
      return { applied: r };
    }))
    .post("/bots/:id/database/reset", g(async (c) => {
      const b = await owned(c.actor, c.params.id!);
      // Typed confirmation: the person must type the bot's id, so a stray click can never erase anything.
      if (z.strictObject({ confirm: z.string() }).parse(c.body).confirm.trim() !== b.slug) throw new PluginError("CONFIRMATION_MISMATCH", "The confirmation did not match.", `Type ${b.slug} exactly to start over.`);
      const r = await b.database.reset(b.id); await done(c.actor, b.id, "bot-db:reset");
      return r;
    }))
    .put("/bots/:id/database/access", g(async (c) => {
      const b = await owned(c.actor, c.params.id!); const r = await b.database.setAccess(b.id, z.strictObject({ enabled: z.boolean() }).parse(c.body).enabled); await done(c.actor, b.id, r.access ? "bot-db:on" : "bot-db:off");
      return r;
    }));
}

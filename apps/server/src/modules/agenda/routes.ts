import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { AgendaScheduler } from "./scheduler";
import { AGENDA_KINDS, AgendaError, type AgendaService } from "./service";

export type AgendaServices = { access: ReturnType<typeof createIdentityAccess>; agenda: AgendaService; scheduler: AgendaScheduler };
const uuid = z.string().uuid();
const date = z.string().datetime({ offset: true }).transform((v) => new Date(v));
const fields = {
  kind: z.enum(AGENDA_KINDS), title: z.string().trim().min(1).max(200), description: z.string().max(4000), location: z.string().max(200),
  startAt: date, endAt: date.nullable(), allDay: z.boolean(), timezone: z.string().min(1).max(64), remindAt: date.nullable(), syncToGoogle: z.boolean(),
};
const schemas = {
  range: z.strictObject({ from: date, to: date, kinds: z.string().optional() }),
  create: z.strictObject({ ...fields, description: fields.description.optional(), location: fields.location.optional(), endAt: fields.endAt.optional(), allDay: fields.allDay.optional(), timezone: fields.timezone.optional(), remindAt: fields.remindAt.optional(), syncToGoogle: fields.syncToGoogle.optional() }),
  update: z.strictObject({ expectedVersion: z.number().int().positive(), status: z.enum(["open", "done", "cancelled"]).optional(), ...z.strictObject(fields).partial().shape }),
  complete: z.strictObject({ done: z.boolean().default(true) }),
  sync: z.strictObject({ enabled: z.boolean().optional(), pushByDefault: z.boolean().optional() }),
};
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => out({ error: { code, message } }, status);

export function createAgendaRoutes({ access, agenda, scheduler }: AgendaServices, trustedOrigins: readonly string[]) {
  type Ctx = { actor: Awaited<ReturnType<typeof access.requireActive>>; body: unknown; params: Record<string, string>; query: Record<string, string | undefined> };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return fail(e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "NOT_FOUND" ? 404 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403, e.code, e.message);
    if (e instanceof AgendaError) return e.code === "NOT_FOUND" ? fail(404, "NOT_FOUND", "That Agenda item no longer exists.") : e.code === "CONFLICT" ? fail(409, "STALE_VERSION", "This item changed. Reload and try again.") : fail(400, "INVALID", e.detail ?? "Check the details and try again.");
    if (e instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = (work: (c: Ctx) => Promise<unknown>, status = 200) => async ({ request, body, params, query }: { request: Request; body: unknown; params: Record<string, string>; query: Record<string, string | undefined> }) => {
    try {
      if (request.method !== "GET") {
        const origin = request.headers.get("origin");
        if (!origin || !trustedOrigins.includes(origin)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again.");
      }
      return out(await work({ actor: await access.requireActive(request.headers), body, params, query }), status);
    } catch (e) { return mapError(e); }
  };
  const id = (c: Ctx) => uuid.parse(c.params.id);
  return new Elysia({ prefix: "/api", normalize: false })
    .get("/agenda", g(async (c) => {
      const v = schemas.range.parse(c.query);
      const kinds = v.kinds ? z.array(z.enum(AGENDA_KINDS)).parse(v.kinds.split(",").filter(Boolean)) : undefined;
      return { items: await agenda.list(c.actor, v.from, v.to, kinds) };
    }))
    .post("/agenda", g(async (c) => ({ item: await agenda.create(c.actor, schemas.create.parse(c.body)) }), 201))
    .get("/agenda/sync", g(async (c) => ({ sync: await agenda.syncSettings(c.actor) })))
    .put("/agenda/sync", g(async (c) => ({ sync: await agenda.setSyncSettings(c.actor, schemas.sync.parse(c.body)) })))
    .post("/agenda/sync/now", g(async (c) => {
      const s = await agenda.syncSettings(c.actor);
      if (!s.enabled) return { result: { ok: false, error: "Turn on Google Calendar sync first." }, sync: s };
      return { result: await scheduler.syncUser(c.actor), sync: await agenda.syncSettings(c.actor) };
    }))
    .get("/agenda/:id", g(async (c) => ({ item: await agenda.get(c.actor, id(c)) })))
    .patch("/agenda/:id", g(async (c) => { const { expectedVersion, ...v } = schemas.update.parse(c.body); return { item: await agenda.update(c.actor, id(c), expectedVersion, v) }; }))
    .post("/agenda/:id/complete", g(async (c) => ({ item: await agenda.complete(c.actor, id(c), schemas.complete.parse(c.body ?? {}).done) })))
    .delete("/agenda/:id", g(async (c) => ({ item: await agenda.remove(c.actor, id(c)) })));
}

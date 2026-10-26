import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { ComputerError, type ComputerService } from "./service";
import type { DesktopService } from "./desktop";

export type ComputerServices = { access: ReturnType<typeof createIdentityAccess>; computer: ComputerService; desktop?: DesktopService };
const profile = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const action = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("open"), url: z.string().url().max(2000) }),
  z.strictObject({ type: z.literal("click"), x: z.number().min(0).max(4000), y: z.number().min(0).max(4000) }),
  z.strictObject({ type: z.literal("type"), text: z.string().max(2000) }),
  z.strictObject({ type: z.literal("key"), key: z.string().min(1).max(30) }),
  z.strictObject({ type: z.literal("scroll"), dy: z.number() }),
]);
const desktopAction = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("click"), x: z.number().min(0).max(8000), y: z.number().min(0).max(8000) }), z.strictObject({ type: z.literal("type"), text: z.string().max(2000) }),
  z.strictObject({ type: z.literal("key"), key: z.string().min(1).max(40) }), z.strictObject({ type: z.literal("scroll"), direction: z.enum(["up", "down", "left", "right"]), amount: z.number().int().min(1).max(20).optional() }),
  z.strictObject({ type: z.literal("launch"), app: z.string().min(1).max(60) }),
]);
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => out({ error: { code, message } }, status);

export function createComputerRoutes({ access, computer, desktop }: ComputerServices, trustedOrigins: readonly string[]) {
  type Ctx = { userId: string; body: unknown; params: Record<string, string> };
  const g = (work: (c: Ctx) => Promise<unknown>, status = 200) => async ({ request, body, params }: { request: Request; body: unknown; params: Record<string, string> }) => {
    try {
      if (request.method !== "GET") { const o = request.headers.get("origin"); if (!o || !trustedOrigins.includes(o)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again."); }
      const actor = await access.requireActive(request.headers);
      return out(await work({ userId: actor.userId, body, params }), status);
    } catch (e) {
      if (e instanceof AccessError) return fail(e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403, e.code, e.message);
      if (e instanceof ComputerError) return fail(e.code === "NOT_FOUND" ? 404 : e.code === "REVOKED" ? 410 : e.code === "LIMIT" || e.code === "HUMAN_IN_CONTROL" || e.code === "STALE_CONTROL" ? 409 : e.code === "UNAVAILABLE" ? 503 : 400, e.code,
        e.code === "BLOCKED_URL" ? "That address is not allowed." : e.code === "LIMIT" ? "Close another browser session first." : e.code === "HUMAN_IN_CONTROL" ? "A person has taken over this session." : e.code === "UNAVAILABLE" ? "The browser is not available right now." : "Check the details and try again.");
      if (e instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Check the details and try again.");
      return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
    }
  };
  const need = () => { if (!desktop) throw new ComputerError("UNAVAILABLE"); return desktop; };
  const p = (c: Ctx) => profile.parse(c.params.profile);
  return new Elysia({ prefix: "/api/computer", normalize: false })
    .get("/sessions", g(async (c) => ({ sessions: computer.list(c.userId) })))
    .post("/sessions", g(async (c) => ({ session: await computer.start(c.userId, profile.parse((c.body as { profile?: string } | null)?.profile ?? "default")) }), 201))
    .post("/sessions/:profile/action", g(async (c) => ({ session: await computer.act(c.userId, p(c), "user", action.parse(c.body)) })))
    .get("/sessions/:profile/screenshot", g(async (c) => ({ png: await computer.screenshot(c.userId, p(c)) })))
    .get("/sessions/:profile/text", g(async (c) => ({ text: await computer.text(c.userId, p(c)) })))
    .post("/sessions/:profile/takeover", g(async (c) => { const v = z.strictObject({ human: z.boolean(), expected: z.enum(["agent", "human"]).optional() }).parse(c.body); return { session: computer.takeover(c.userId, p(c), v.human, v.expected) }; }))
    .get("/capabilities", g(async () => ({ ...computer.capabilities(), desktop: Boolean(desktop), desktopBackend: desktop ? "cua-spaces" : null, note: desktop ? "Desktop control runs in a per-user Linux container Space (Cua). Browser sessions are separate." : computer.capabilities().note })))
    .get("/desktop/sessions", g(async (c) => ({ sessions: need().list(c.userId) })))
    .post("/desktop/sessions", g(async (c) => ({ session: await need().start(c.userId, profile.parse((c.body as { profile?: string } | null)?.profile ?? "default")) }), 201))
    .post("/desktop/sessions/:profile/action", g(async (c) => ({ session: await need().act(c.userId, p(c), "user", desktopAction.parse(c.body)) })))
    .get("/desktop/sessions/:profile/screenshot", g(async (c) => ({ png: await need().screenshot(c.userId, p(c)) })))
    .get("/desktop/sessions/:profile/text", g(async (c) => ({ text: await need().read(c.userId, p(c)) })))
    .post("/desktop/sessions/:profile/takeover", g(async (c) => { const v = z.strictObject({ human: z.boolean(), expected: z.enum(["agent", "human"]).optional() }).parse(c.body); return { session: need().takeover(c.userId, p(c), v.human, v.expected) }; }))
    .delete("/desktop/sessions/:profile", g(async (c) => { await need().close(c.userId, p(c)); return { ok: true }; }))
    .get("/profiles", g(async (c) => ({ profiles: await computer.profiles(c.userId) })))
    .post("/profiles/:profile/reset", g(async (c) => { await computer.reset(c.userId, p(c)); return { ok: true }; }))
    .delete("/profiles/:profile", g(async (c) => { await computer.revokeProfile(c.userId, p(c)); return { ok: true }; }))
    .delete("/sessions/:profile", g(async (c) => { await computer.close(c.userId, p(c)); return { ok: true }; }));
}

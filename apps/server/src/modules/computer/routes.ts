import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { ComputerError, type ComputerService } from "./service";
import type { DesktopService } from "./desktop";
import type { VmService } from "./vm";
import { openVncBridge, type VncBridge } from "./vnc";

export type ComputerServices = { access: ReturnType<typeof createIdentityAccess>; computer: ComputerService; desktop?: DesktopService; vms?: VmService };
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
const vmAction = z.discriminatedUnion("type", [
  ...desktopAction.options, z.strictObject({ type: z.literal("navigate"), url: z.string().url().max(2000) }),
]);
const vmId = z.string().uuid();
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => out({ error: { code, message } }, status);

export function createComputerRoutes({ access, computer, desktop, vms }: ComputerServices, trustedOrigins: readonly string[]) {
  type Ctx = { userId: string; body: unknown; params: Record<string, string> };
  const g = (work: (c: Ctx) => Promise<unknown>, status = 200) => async ({ request, body, params }: { request: Request; body: unknown; params: Record<string, string> }) => {
    try {
      if (request.method !== "GET") { const o = request.headers.get("origin"); if (!o || !trustedOrigins.includes(o)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again."); }
      const actor = await access.requireActive(request.headers);
      return out(await work({ userId: actor.userId, body, params }), status);
    } catch (e) {
      if (e instanceof AccessError) return fail(e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403, e.code, e.message);
      if (e instanceof ComputerError) return fail(e.code === "NOT_FOUND" ? 404 : e.code === "REVOKED" ? 410 : e.code === "LIMIT" || e.code === "HUMAN_IN_CONTROL" || e.code === "STALE_CONTROL" ? 409 : e.code === "UNAVAILABLE" ? 503 : 400, e.code,
        e.code === "BLOCKED_URL" ? "That address is not allowed." : e.code === "LIMIT" ? "Close another browser session or stop a desktop first." : e.code === "HUMAN_IN_CONTROL" ? "A person has taken over this session." : e.code === "UNAVAILABLE" ? "The browser is not available right now." : "Check the details and try again.");
      if (e instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Check the details and try again.");
      return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
    }
  };
  const need = () => { if (!desktop) throw new ComputerError("UNAVAILABLE"); return desktop; };
  const p = (c: Ctx) => profile.parse(c.params.profile);
  const needVms = () => { if (!vms) throw new ComputerError("UNAVAILABLE"); return vms; };
  const v = (c: Ctx) => vmId.parse(c.params.id);
  /** Live VNC viewers, by socket: the bridge to the VM opens asynchronously, and bytes the browser sends meanwhile wait in `early`. */
  const viewers = new Map<object, { bridge?: VncBridge; early: Uint8Array[]; release?: () => void; closed?: boolean }>();
  return new Elysia({ prefix: "/api/computer", normalize: false })
    .get("/sessions", g(async (c) => ({ sessions: computer.list(c.userId) })))
    .post("/sessions", g(async (c) => ({ session: await computer.start(c.userId, profile.parse((c.body as { profile?: string } | null)?.profile ?? "default")) }), 201))
    .post("/sessions/:profile/action", g(async (c) => ({ session: await computer.act(c.userId, p(c), "user", action.parse(c.body)) })))
    .get("/sessions/:profile/screenshot", g(async (c) => ({ png: await computer.screenshot(c.userId, p(c)) })))
    .get("/sessions/:profile/text", g(async (c) => ({ text: await computer.text(c.userId, p(c)) })))
    .post("/sessions/:profile/takeover", g(async (c) => { const v = z.strictObject({ human: z.boolean(), expected: z.enum(["agent", "human"]).optional() }).parse(c.body); return { session: computer.takeover(c.userId, p(c), v.human, v.expected) }; }))
    .get("/capabilities", g(async () => ({ ...computer.capabilities(), desktop: Boolean(desktop || vms), desktopBackend: vms ? "vm" : desktop ? "cua-spaces" : null, note: vms ? "Each user has a persistent Linux desktop (Debian + Chromium); bots can ask for more. Browser sessions are separate." : desktop ? "Desktop control runs in a per-user Linux container Space (Cua). Browser sessions are separate." : computer.capabilities().note })))
    .get("/vms", g(async (c) => ({ vms: await needVms().list(c.userId) })))
    .post("/vms/default/start", g(async (c) => ({ vm: await needVms().start(c.userId) })))
    .post("/vms/:id/start", g(async (c) => ({ vm: await needVms().start(c.userId, v(c)) })))
    .post("/vms/:id/stop", g(async (c) => { await needVms().stop(c.userId, v(c)); return { ok: true }; }))
    .delete("/vms/:id", g(async (c) => { await needVms().remove(c.userId, v(c)); return { ok: true }; }))
    .post("/vms/:id/action", g(async (c) => ({ vm: await needVms().act(c.userId, v(c), "user", vmAction.parse(c.body)) })))
    .post("/vms/:id/paste", g(async (c) => { await needVms().paste(c.userId, v(c), z.strictObject({ text: z.string().min(1).max(4000) }).parse(c.body).text); return { ok: true }; }))
    .post("/vms/:id/keyboard", g(async (c) => ({ keyboard: await needVms().keyboard(c.userId, v(c), z.strictObject({ layout: z.string().max(20) }).parse(c.body).layout) })))
    .post("/vms/:id/vnc-ticket", g(async (c) => ({ ticket: needVms().vncTicket(c.userId, v(c)) })))
    // The browser's VNC client (noVNC). Browsers send no custom headers on a WebSocket: the one-time ticket from vnc-ticket (an
    // authenticated, origin-checked POST) is the credential, and the Origin is checked again here against cross-site sockets.
    .ws("/vms/:id/vnc", {
      async open(ws) {
        const state: { bridge?: VncBridge; early: Uint8Array[]; release?: () => void; closed?: boolean } = { early: [] };
        viewers.set(ws.raw, state);
        try {
          const origin = ws.data.headers.origin;
          if (!origin || !trustedOrigins.includes(origin)) throw new ComputerError("NOT_FOUND");
          const viewer = needVms().vncViewer(String((ws.data.query as Record<string, unknown>).ticket ?? ""), vmId.parse(ws.data.params.id));
          state.release = viewer.release;
          const bridge = await openVncBridge({ port: viewer.port, password: viewer.password, viewer: { send: (b) => { ws.raw.send(b); }, close: (code, reason) => ws.raw.close(code, reason) } });
          if (state.closed) { bridge.close(); return; }
          state.bridge = bridge;
          for (const b of state.early.splice(0)) bridge.fromViewer(b);
        } catch { state.release?.(); ws.raw.close(4404, "This computer is not running."); }
      },
      message(ws, message) {
        const state = viewers.get(ws.raw);
        if (!state || !(message instanceof Uint8Array)) return;
        if (state.bridge) state.bridge.fromViewer(message); else state.early.push(message);
      },
      close(ws) {
        const state = viewers.get(ws.raw); viewers.delete(ws.raw);
        if (!state) return;
        state.closed = true; state.bridge?.close(); state.release?.();
      },
    })
    .get("/vms/:id/screenshot", g(async (c) => ({ png: await needVms().screenshot(c.userId, v(c)) })))
    .get("/vms/:id/text", g(async (c) => ({ text: await needVms().read(c.userId, v(c)) })))
    .post("/vms/:id/takeover", g(async (c) => { const b = z.strictObject({ human: z.boolean(), expected: z.enum(["agent", "human"]).optional() }).parse(c.body); return { vm: needVms().takeover(c.userId, v(c), b.human, b.expected) }; }))
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

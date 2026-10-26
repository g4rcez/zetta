import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { DecisionError, type DecisionService } from "./service";

export type DecisionServices = { access: ReturnType<typeof createIdentityAccess>; decisions: DecisionService };
const text = (n: number) => z.string().min(1).max(n);
const option = text(80);
const question = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("choice"), instructions: text(300), criteria: z.record(option, text(200)).refine((r) => { const n = Object.keys(r).length; return n >= 2 && n <= 12; }) }),
  z.strictObject({ type: z.literal("score"), instructions: text(300), criteria: z.array(option).min(2).max(8) }),
  z.strictObject({ type: z.literal("noul"), instructions: text(300) }),
]);
const request = z.strictObject({ subject: z.union([text(8000), z.record(z.string(), z.unknown())]), questions: z.record(z.string().regex(/^[a-z0-9_]{1,32}$/), question).refine((q) => { const n = Object.keys(q).length; return n >= 1 && n <= 8; }) });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function createDecisionRoutes({ access, decisions }: DecisionServices, trustedOrigins: readonly string[]) {
  return new Elysia({ prefix: "/api/decisions", normalize: false })
    .get("/status", async ({ request: r }) => { try { await access.requireActive(r.headers); return json(decisions.status()); } catch (e) { return e instanceof AccessError ? json({ error: { code: e.code } }, 401) : json({ error: { code: "UNAVAILABLE" } }, 503); } })
    .post("/", async ({ request: r, body }) => {
      try {
        const origin = r.headers.get("origin");
        if (!origin || !trustedOrigins.includes(origin)) return json({ error: { code: "UNTRUSTED_ORIGIN", message: "Open Zetta from its trusted application." } }, 403);
        await access.requireActive(r.headers);
        const v = request.parse(body);
        return json(await Promise.race([decisions.decide(v.subject, v.questions as never)]));
      } catch (e) {
        if (e instanceof AccessError) return json({ error: { code: e.code } }, e.code === "SIGN_IN_REQUIRED" ? 401 : 403);
        if (e instanceof z.ZodError) return json({ error: { code: "INVALID_REQUEST", message: "Check the details and try again." } }, 400);
        return json({ error: { code: e instanceof DecisionError ? e.code.toUpperCase() : "DECISION_UNAVAILABLE", message: "The decision model is not ready. Try again shortly." } }, 503);
      }
    });
}

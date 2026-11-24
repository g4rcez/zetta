import { Elysia } from "elysia";
import { z } from "zod";
import { SETTING_KEY_MAX } from "@zetta/core/settings";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import { SettingsError, type SettingsService } from "./service";

export type SettingsServices = {
  access: ReturnType<typeof createIdentityAccess>;
  settings: SettingsService;
};

const scopeQuery = z.strictObject({ organizationId: z.string().max(36).optional() });
const putInput = z.strictObject({
  // A number, a text or a list of texts. A boolean is not a setting value: a switch is the text "on" or "off".
  value: z.union([z.string().max(20_000), z.number(), z.array(z.string().max(2000)).max(256)]),
  organizationId: z.string().max(36).optional(),
});
const keyParam = z.string().min(1).max(SETTING_KEY_MAX);

/**
 * Server settings, for administrators only: the page that lists them, saves one and resets one. They need no sealed transport key, so any
 * `api` instance may serve them (they are not in worker-only.ts and need no route of their own in the load balancer).
 */
export function createSettingsRoutes(
  { access, settings }: SettingsServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof SettingsError)
      return e.code === "UNKNOWN_KEY"
        ? fail(404, "NOT_FOUND", e.message)
        : e.code === "SENSITIVE"
          ? fail(403, "ACCESS_DENIED", e.message)
          : fail(400, "INVALID_REQUEST", e.message);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const admin = async (headers: Headers) => {
    const actor = await access.requireActive(headers);
    if (!actor.isAdmin) throw new AccessError("ACCESS_DENIED");
    return actor;
  };
  return new Elysia({ prefix: "/api/settings", normalize: false })
    .get("/", async ({ request, query }) => {
      try {
        const actor = await admin(request.headers);
        const { organizationId } = scopeQuery.parse(query);
        return out(await settings.list(actor, organizationId ? { organizationId } : {}));
      } catch (e) {
        return mapError(e);
      }
    })
    .put("/:key", async ({ request, params, body }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        const actor = await admin(request.headers);
        const input = putInput.parse(body);
        return out(
          await settings.set(actor, keyParam.parse(params.key), input.value, {
            via: "person",
            ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          }),
        );
      } catch (e) {
        return mapError(e);
      }
    })
    .delete("/:key", async ({ request, params, query }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        const actor = await admin(request.headers);
        const { organizationId } = scopeQuery.parse(query);
        return out(
          await settings.unset(actor, keyParam.parse(params.key), {
            via: "person",
            ...(organizationId ? { organizationId } : {}),
          }),
        );
      } catch (e) {
        return mapError(e);
      }
    });
}

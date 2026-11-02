import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { isLayaTag } from "@zetta/core/laya-languages";
import {
  InvalidInstallationError,
  withLayaModel,
  type InstallationService,
  type NetworkMode,
} from "./service";

export type InstallationServices = {
  access: ReturnType<typeof createIdentityAccess>;
  installation: InstallationService;
  /** Network mode the process booted with; a saved change applies after a restart. */
  runningMode: NetworkMode;
};

const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) =>
  out({ error: { code, message } }, status);
const patchInput = z.strictObject({
  networkMode: z.enum(["local", "network"]).optional(),
  publicUrl: z
    .url({ protocol: /^https$/ })
    .max(512)
    .nullable()
    .optional(),
  onboarding: z.enum(["pending", "done"]).optional(),
  laya: z.enum(["on", "off"]).optional(),
  layaLanguages: z.array(z.string().refine(isLayaTag)).max(64).optional(),
});

export function createInstallationRoutes(
  { access, installation, runningMode }: InstallationServices,
  trustedOrigins: readonly string[],
) {
  const body = async (settings: Awaited<ReturnType<typeof installation.load>>) => ({
    ...withLayaModel(settings),
    restartRequired: settings.networkMode !== runningMode,
  });
  function mapError(e: unknown) {
    if (e instanceof AccessError)
      return fail(
        e.code === "SIGN_IN_REQUIRED" ? 401 : e.code === "IDENTITY_UNAVAILABLE" ? 503 : 403,
        e.code,
        e.message,
      );
    if (e instanceof InvalidInstallationError)
      return fail(400, "INVALID_REQUEST", "Network mode needs an https public URL.");
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  return new Elysia({ prefix: "/api/installation", normalize: false })
    .get("/", async ({ request }) => {
      try {
        await access.requireActive(request.headers);
        return out(await body(await installation.load()));
      } catch (e) {
        return mapError(e);
      }
    })
    .patch("/", async ({ request, body: raw }) => {
      try {
        const origin = request.headers.get("origin");
        if (!origin || !trustedOrigins.includes(origin))
          return fail(
            403,
            "UNTRUSTED_ORIGIN",
            "Open Zetta from its trusted application and try again.",
          );
        const actor = await access.requireActive(request.headers);
        if (!("isAdmin" in actor && actor.isAdmin)) throw new AccessError("ACCESS_DENIED");
        return out(await body(await installation.update(patchInput.parse(raw))));
      } catch (e) {
        return mapError(e);
      }
    });
}

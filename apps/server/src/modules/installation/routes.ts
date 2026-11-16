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
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import { assertPublicUrl } from "../computer/service";
import { languageCode, TranscribeError, type Transcriber } from "../transcribe/transcriber";

export type InstallationServices = {
  access: ReturnType<typeof createIdentityAccess>;
  installation: InstallationService;
  /** Network mode the process booted with; a saved change applies after a restart. */
  runningMode: NetworkMode;
  /** Speech to text: what the administrator chose is read by `transcriber` itself; these serve the settings card. */
  transcriber?: Transcriber;
  /** Whether a key is there for speech to text: none, a saved connection (still readable or not), or the operator's own. */
  transcribeKey?: {
    state(connectionId: string | null): Promise<"none" | "set" | "operator" | "unavailable">;
  };
  /** Private network addresses allowed by the operator (ZETTA_ALLOW_PRIVATE_NETWORK): a provider on the local network, over http. */
  allowPrivate?: boolean;
};

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
  transcribeProvider: z.enum(["local", "openai", "compatible"]).optional(),
  transcribeModel: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9._:/-]*$/)
    .optional(),
  // Empty means "the language of the person's browser". A tag ("pt-BR") or a name ("portuguese") is stored as its two-letter code.
  transcribeLanguage: z
    .string()
    .trim()
    .max(35)
    .refine((v) => v === "" || languageCode(v) !== undefined)
    .transform((v) => (v === "" ? "" : languageCode(v)!))
    .optional(),
  transcribeBaseUrl: z.string().trim().max(512).optional(),
});
const TEST_PER_MINUTE = 6;

export function createInstallationRoutes(
  {
    access,
    installation,
    runningMode,
    transcriber,
    transcribeKey,
    allowPrivate,
  }: InstallationServices,
  trustedOrigins: readonly string[],
) {
  const testCalls = new Map<string, number[]>();
  const body = async (settings: Awaited<ReturnType<typeof installation.load>>) => ({
    ...withLayaModel(settings),
    restartRequired: settings.networkMode !== runningMode,
    transcribeKey: transcribeKey
      ? await transcribeKey.state(settings.transcribeConnectionId)
      : "none",
  });
  /** The address of a speech-to-text server is typed by an administrator: https, and not a private network unless the operator allowed it. */
  async function checkBaseUrl(raw: string) {
    if (!raw) return;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new InvalidInstallationError("That is not a web address.");
    }
    if (u.username || u.password || u.search || u.hash)
      throw new InvalidInstallationError(
        "Give the address without a user name, password or query.",
      );
    if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:"))
      throw new InvalidInstallationError("The speech-to-text address must start with https://.");
    if (!allowPrivate)
      await assertPublicUrl(raw).catch(() => {
        throw new InvalidInstallationError(
          "That address is not allowed: private addresses must be enabled by the operator.",
        );
      });
  }
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof InvalidInstallationError)
      return fail(400, "INVALID_REQUEST", e.message || "Network mode needs an https public URL.");
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  return (
    new Elysia({ prefix: "/api/installation", normalize: false })
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
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin)) throw new AccessError("ACCESS_DENIED");
          const patch = patchInput.parse(raw);
          if (patch.transcribeBaseUrl !== undefined) await checkBaseUrl(patch.transcribeBaseUrl);
          return out(await body(await installation.update(patch)));
        } catch (e) {
          return mapError(e);
        }
      })
      // Tries the chosen speech-to-text with one second of silence: shows the administrator, before anybody records, whether the key, the
      // address and the model work. It costs next to nothing at a provider. Never says more than the fixed sentence of the error.
      .post("/transcribe/test", async ({ request }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin) || !transcriber)
            throw new AccessError("ACCESS_DENIED");
          const now = Date.now();
          const recent = (testCalls.get(actor.userId) ?? []).filter((t) => now - t < 60_000);
          if (recent.length >= TEST_PER_MINUTE)
            return out({
              ok: false,
              message: "That was a lot of tests. Wait a minute and try again.",
            });
          testCalls.set(actor.userId, [...recent, now]);
          const settings = await installation.load();
          try {
            await transcriber.transcribe(new Float32Array(16_000));
            return out({ ok: true, provider: settings.transcribeProvider });
          } catch (e) {
            if (e instanceof TranscribeError) return out({ ok: false, message: e.safe });
            return out({
              ok: false,
              message: "The speech model could not run. Try again in a moment.",
            });
          }
        } catch (e) {
          return mapError(e);
        }
      })
  );
}

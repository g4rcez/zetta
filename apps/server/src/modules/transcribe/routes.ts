import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import type { Transcribe } from "./service";
import { TranscribeError } from "./transcriber";

export type TranscribeServices = {
  access: ReturnType<typeof createIdentityAccess>;
  transcribe: Transcribe;
};

/** The browser sends 16 kHz mono 16-bit samples as base64: 5 minutes are 9.6 MB, 12.8 MB as text. */
const body = z.strictObject({
  pcmBase64: z.string().min(1).max(13_000_000),
  /** The language the person speaks, from their browser ("pt-BR"). */
  language: z.string().max(35).optional(),
});
const PER_MINUTE = 6;

const STATUS: Record<TranscribeError["code"], number> = {
  DISABLED: 503,
  TOO_LONG: 413,
  TOO_BIG: 413,
  NO_DECODER: 415,
  UNREADABLE: 400,
  BUSY: 429,
  PROVIDER_AUTH: 502,
  NOT_CONFIGURED: 503,
  FAILED: 502,
};

/** `POST /api/transcribe`: speech to text for the microphone of the message box. At most a few recordings a minute per person. */
export function createTranscribeRoutes(
  { access, transcribe }: TranscribeServices,
  trustedOrigins: readonly string[],
) {
  const calls = new Map<string, number[]>();
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof TranscribeError) return fail(STATUS[e.code], `TRANSCRIBE_${e.code}`, e.safe);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Send the recording as 16 kHz mono samples.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  return new Elysia({ prefix: "/api", normalize: false }).post(
    "/transcribe",
    g(async (c) => {
      const v = body.parse(c.body);
      const now = Date.now();
      const recent = (calls.get(c.actor.userId) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= PER_MINUTE)
        throw new TranscribeError(
          "BUSY",
          "That was a lot of recordings. Wait a minute and try again.",
        );
      calls.set(c.actor.userId, [...recent, now]);
      return {
        text: await transcribe.fromPcm(Buffer.from(v.pcmBase64, "base64"), undefined, v.language),
      };
    }),
  );
}

import type { Database } from "@zetta/db";
import { Elysia } from "elysia";
import { z } from "zod";

import { audit } from "../features/audit";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import { ImportError, type ImportErrorCode } from "../bots/import/errors";
import { parseGrokUrl } from "../bots/import/grok-source";
import type { BotImport } from "../bots/import/service";

export type BotImportServices = {
  access: ReturnType<typeof createIdentityAccess>;
  db: Database;
  botImport: BotImport;
};

const STATUS: Record<ImportErrorCode, number> = {
  BAD_URL: 400,
  INVALID_DRAFT: 400,
  NOT_FOUND: 404,
  NO_CHIEF_ENGINE: 409,
  FULL: 409,
  DUPLICATE: 409,
  PAGE_CHANGED: 502,
  FETCH_FAILED: 502,
  ANALYZE_FAILED: 502,
};

const analyzeBody = z.strictObject({
  source: z.string().trim().min(1).max(300),
  timezone: z.string().trim().min(1).max(64),
});
// The installer checks the draft itself (the same schema Chief's card uses); here it only has to be there.
const installBody = z.strictObject({ draft: z.unknown() });

/** The bot import API (browse, preview, analyze, install). Typed as a bare Elysia like the other modules: app.ts chains them all. */
export function createBotImportRoutes(
  { access, db, botImport }: BotImportServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  type Ctx = { actor: ActiveActor; body: unknown; params: Record<string, string> };

  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof ImportError) return fail(STATUS[e.code], e.code, e.message);
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    console.error(`bot-import: unhandled error name=${(e as Error | undefined)?.name ?? typeof e}`);
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g =
    (work: (c: Ctx) => Promise<unknown>, status = 200) =>
    async ({
      request,
      body,
      params,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
    }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        return out(
          await work({ actor: await access.requireActive(request.headers), body, params }),
          status,
        );
      } catch (e) {
        return mapError(e);
      }
    };

  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/bot-import/grok",
      g(async () => ({ bots: await botImport.list() })),
    )
    .get(
      "/bot-import/grok/:id",
      g(async (c) => ({ bot: await botImport.preview(parseGrokUrl(c.params.id ?? "")) })),
    )
    .post(
      "/bot-import/grok/analyze",
      g(async (c) => {
        const input = analyzeBody.parse(c.body);
        return {
          draft: await botImport.analyze(c.actor.userId, input.source, {
            timezone: input.timezone,
          }),
        };
      }),
    )
    .post(
      "/bot-import/install",
      g(async (c) => {
        const input = installBody.parse(c.body);
        const result = await botImport.install(c.actor, input.draft);
        await audit(db, c.actor.userId, {
          kind: "tool_call",
          outcome: "ok",
          detail: "bot:import",
          botId: result.bot.id,
          subjectId: result.bot.id,
        });
        return { result };
      }, 201),
    ) as unknown as Elysia<"/api">;
}

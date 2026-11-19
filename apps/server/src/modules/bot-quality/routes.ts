import { Elysia } from "elysia";
import { z } from "zod";
import { BotNameError, FallbackError, ModelError } from "../chat/service";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import {
  driveChoiceInput,
  drivePromptInput,
  feedbackInput,
  QualityError,
  type BotQuality,
} from "./service";

export type BotQualityServices = {
  access: ReturnType<typeof createIdentityAccess>;
  quality: BotQuality;
};

const uuid = z.string().uuid();
const STATUS: Record<QualityError["code"], number> = {
  NOT_FOUND: 404,
  INVALID: 400,
  CONFLICT: 409,
  TOO_MANY: 409,
  BUSY: 409,
};

/** Ratings, the numbers, saved tests and version history of the person's own bots (see docs/decisions/bot-improvement.md). */
export function createBotQualityRoutes(
  { access, quality }: BotQualityServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof QualityError) return fail(STATUS[e.code], e.code, e.safe);
    if (e instanceof ModelError || e instanceof FallbackError)
      return fail(
        409,
        "CONFLICT",
        "That version used an engine or model that this bot can no longer use. Change the engine first.",
      );
    if (e instanceof BotNameError)
      return fail(409, "CONFLICT", "That version's name is not allowed any more.");
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const id = (c: { params: Record<string, string> }) => uuid.parse(c.params.id);
  const promptId = (c: { params: Record<string, string> }) => uuid.parse(c.params.promptId);
  return new Elysia({ prefix: "/api", normalize: false })
    .put(
      "/messages/:id/feedback",
      g(async (c) => ({
        feedback: await quality.rate(c.actor, id(c), feedbackInput.parse(c.body)),
      })),
    )
    .delete(
      "/messages/:id/feedback",
      g(async (c) => quality.clearRating(c.actor, id(c))),
    )
    .get(
      "/conversations/:id/feedback",
      g(async (c) => ({ feedback: await quality.ratingsOf(c.actor, id(c)) })),
    )
    .get(
      "/bots/:id/stats",
      g(async (c) => {
        const days = z
          .enum(["7", "30"])
          .default("7")
          .parse(c.query.days ?? "7");
        return { stats: await quality.stats(c.actor, id(c), days === "30" ? 30 : 7) };
      }),
    )
    .get(
      "/bots/:id/activity",
      g(async (c) => {
        const tz = z.string().max(64).optional().parse(c.query.tz);
        return { activity: await quality.activity(c.actor, id(c), tz) };
      }),
    )
    .get(
      "/bots/:id/drive",
      g(async (c) => quality.drive(c.actor, id(c))),
    )
    .post(
      "/bots/:id/drive/prompts",
      g(
        async (c) => ({
          prompt: await quality.addPrompt(c.actor, id(c), drivePromptInput.parse(c.body)),
        }),
        201,
      ),
    )
    .patch(
      "/bots/:id/drive/prompts/:promptId",
      g(async (c) => ({
        prompt: await quality.updatePrompt(
          c.actor,
          id(c),
          promptId(c),
          drivePromptInput.parse(c.body),
        ),
      })),
    )
    .delete(
      "/bots/:id/drive/prompts/:promptId",
      g(async (c) => quality.removePrompt(c.actor, id(c), promptId(c))),
    )
    .post(
      "/bots/:id/drive/run",
      g(async (c) => {
        const body = z.strictObject({ promptId: uuid.optional() }).parse(c.body ?? {});
        return quality.run(c.actor, id(c), body.promptId);
      }, 202),
    )
    .post(
      "/bots/:id/drive/compare",
      g(async (c) => {
        const body = z.strictObject({ promptId: uuid }).parse(c.body ?? {});
        return quality.compare(c.actor, id(c), body.promptId);
      }, 202),
    )
    .post(
      "/bots/:id/drive/pairs/:pairId/choose",
      g(async (c) =>
        quality.choose(c.actor, id(c), uuid.parse(c.params.pairId), driveChoiceInput.parse(c.body)),
      ),
    )
    .get(
      "/bots/:id/revisions",
      g(async (c) => quality.revisions(c.actor, id(c))),
    )
    .post(
      "/bots/:id/revisions/:version/restore",
      g(async (c) => {
        const version = z.coerce.number().int().positive().parse(c.params.version);
        const body = z.strictObject({ expectedVersion: z.number().int().positive() }).parse(c.body);
        return quality.restore(c.actor, id(c), version, body.expectedVersion);
      }),
    );
}

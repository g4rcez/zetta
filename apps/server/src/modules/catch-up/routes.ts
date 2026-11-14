import { Elysia } from "elysia";
import { z } from "zod";
import { DiscussionError } from "../discussions/store";
import { RoutineError } from "../features/routines";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { InboundError } from "../inbound/service";
import { MemoryError } from "../memory/service";
import { AgentsPausedError } from "../preferences/agents-state";
import { TaskRuleError } from "../tasks/follow-up";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { CatchUpError, type CatchUpActions } from "./act";
import { buildQueue, summarize, type CatchUpDeps } from "./queue";

export type CatchUpServices = {
  access: ReturnType<typeof createIdentityAccess>;
  catchUp: CatchUpDeps;
  actions: CatchUpActions;
};

const listQuery = z.object({ bot: z.string().uuid().optional() });
const actBody = z.strictObject({ text: z.string().max(4000).optional() });
const uuid = z.string().uuid();

export function createCatchUpRoutes(
  { access, catchUp, actions }: CatchUpServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    if (e instanceof CatchUpError)
      return fail(e.code === "NO_SUBJECT" ? 409 : 400, e.code, e.message);
    // The domain said no (a rule, a missing prerequisite, agents paused): the card stays, and the person is told why.
    if (e instanceof TaskRuleError) return fail(409, e.code, e.message);
    if (e instanceof DiscussionError || e instanceof InboundError) return fail(409, e.code, e.safe);
    if (e instanceof RoutineError)
      return fail(
        409,
        e.code,
        e.code === "NOT_READY" && e.missing.length
          ? `Set this routine up first: ${e.missing.join(", ")}.`
          : "The routine could not be changed. Open it to see why.",
      );
    if (e instanceof MemoryError)
      return fail(
        409,
        e.code,
        e.code === "CONFLICT"
          ? "The page changed after this was suggested, so the suggestion is out of date."
          : e.code === "NOT_FOUND"
            ? "That suggestion is no longer open."
            : "The memory page could not be changed.",
      );
    if (e instanceof AgentsPausedError)
      return fail(409, "AGENTS_PAUSED", "Your agents are paused. Resume them first.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  return (
    new Elysia({ prefix: "/api", normalize: false })
      .get(
        "/catch-up",
        g(async (c) => {
          const { bot } = listQuery.parse(c.query);
          return { items: await buildQueue(catchUp, c.actor, bot ? { botId: bot } : {}) };
        }),
      )
      // The badge and the list come from the same function, so they can not disagree.
      .get(
        "/catch-up/summary",
        g(async (c) => summarize(await buildQueue(catchUp, c.actor))),
      )
      // Approvals are decided by POST /api/proposals/:id/decision; these two are for the other cards.
      .post(
        "/catch-up/:id/act",
        g(async (c) => actions.act(c.actor, uuid.parse(c.params.id), actBody.parse(c.body ?? {}))),
      )
      .post(
        "/catch-up/:id/deny",
        g(async (c) => actions.deny(c.actor, uuid.parse(c.params.id))),
      )
  );
}

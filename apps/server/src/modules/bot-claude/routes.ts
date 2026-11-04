import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { Elysia } from "elysia";
import { z } from "zod";
import { dockerConfig } from "../chat/harness";
import { audit } from "../features/audit";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import { assetInput, configInput, EFFORTS, LIMITS, MODELS, presetsFor } from "./profile";
import { ClaudeConfigError, type BotClaude } from "./store";
import { accessFail, createGuardedRoute, fail } from "../http-response";

export type BotClaudeServices = {
  access: ReturnType<typeof createIdentityAccess>;
  db: Database;
  claude: BotClaude;
};
const uuid = z.string().uuid();

/** The Claude Code tab of a bot's settings. Only the bot's owner may read or change it, because it decides what the bot may do on the server. */
export function createBotClaudeRoutes(
  { access, db, claude }: BotClaudeServices,
  trustedOrigins: readonly string[],
) {
  async function owned(actor: ActiveActor, id: string) {
    const [row] = await db
      .select({ id: bot.id, harness: bot.harness })
      .from(bot)
      .where(
        and(eq(bot.id, uuid.parse(id)), eq(bot.ownerUserId, actor.userId), eq(bot.archived, false)),
      );
    if (!row) throw new AccessError("NOT_FOUND");
    return row;
  }
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof ClaudeConfigError)
      return fail(e.code === "NOT_FOUND" ? 404 : 409, e.code, e.safe);
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    console.error(`bot claude: unhandled error name=${(e as Error | undefined)?.name ?? typeof e}`);
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const done = (actor: ActiveActor, botId: string, detail: string) =>
    audit(db, actor.userId, { kind: "tool_call", botId, outcome: "ok", detail });

  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/bots/:id/claude",
      g(async (c) => {
        const b = await owned(c.actor, c.params.id!);
        return {
          ...(await claude.get(b.id)),
          harness: b.harness,
          container: Boolean(dockerConfig()),
          options: {
            presets: presetsFor(b.harness),
            efforts: EFFORTS,
            models: MODELS,
            limits: LIMITS,
          },
        };
      }),
    )
    .put(
      "/bots/:id/claude",
      g(async (c) => {
        const b = await owned(c.actor, c.params.id!);
        const config = await claude.save(b.id, configInput.parse(c.body));
        await done(c.actor, b.id, "claude-config:save");
        return { config };
      }),
    )
    .post(
      "/bots/:id/claude/assets",
      g(async (c) => {
        const b = await owned(c.actor, c.params.id!);
        const asset = await claude.addAsset(b.id, assetInput.parse(c.body));
        await done(c.actor, b.id, `claude-${asset.kind}:add`);
        return { asset };
      }),
    )
    .put(
      "/bots/:id/claude/assets/:assetId",
      g(async (c) => {
        const b = await owned(c.actor, c.params.id!);
        const asset = await claude.updateAsset(
          b.id,
          uuid.parse(c.params.assetId),
          assetInput.parse(c.body),
        );
        await done(c.actor, b.id, `claude-${asset.kind}:edit`);
        return { asset };
      }),
    )
    .delete(
      "/bots/:id/claude/assets/:assetId",
      g(async (c) => {
        const b = await owned(c.actor, c.params.id!);
        await claude.removeAsset(b.id, uuid.parse(c.params.assetId));
        await done(c.actor, b.id, "claude-asset:remove");
        return { removed: true };
      }),
    );
}

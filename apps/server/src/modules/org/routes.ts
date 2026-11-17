import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { orgBodies, orgUuid } from "./inputs";
import { OrgError, type OrgStore } from "./store";

export type OrgServices = { access: ReturnType<typeof createIdentityAccess>; org: OrgStore };

const uuid = orgUuid;
const schemas = orgBodies;

const STATUS: Record<OrgError["code"], number> = {
  INVALID: 400,
  NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
};

export function createOrgRoutes({ access, org }: OrgServices, trustedOrigins: readonly string[]) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof OrgError) return fail(STATUS[e.code], e.code, e.safe);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const id = (c: { params: Record<string, string> }) => uuid.parse(c.params.id);
  return new Elysia({ prefix: "/api/org", normalize: false })
    .get(
      "/",
      g(async (c) => ({ org: await org.get(c.actor) })),
    )
    .post(
      "/positions",
      g(async (c) => {
        const { expectedVersion, ...v } = schemas.create.parse(c.body);
        return { org: await org.create(c.actor, expectedVersion, v) };
      }, 201),
    )
    .patch(
      "/positions/:id",
      g(async (c) => {
        const { expectedVersion, ...v } = schemas.update.parse(c.body);
        return { org: await org.update(c.actor, expectedVersion, id(c), v) };
      }),
    )
    .post(
      "/positions/:id/move",
      g(async (c) => {
        const v = schemas.move.parse(c.body);
        return { org: await org.move(c.actor, v.expectedVersion, id(c), v.parentId, v.index) };
      }),
    )
    .put(
      "/positions/:id/seat",
      g(async (c) => {
        const v = schemas.seat.parse(c.body);
        return { org: await org.seat(c.actor, v.expectedVersion, id(c), v.holder, v.shareBot) };
      }),
    )
    .delete(
      "/positions/:id",
      g(async (c) => {
        const v = schemas.expected.parse(c.query);
        return { org: await org.remove(c.actor, v.expectedVersion, id(c)) };
      }),
    )
    .get(
      "/links",
      g(async (c) => ({ links: await org.links(c.actor) })),
    )
    .get(
      "/draft",
      g(async (c) => {
        const q = schemas.draftQuery.parse(c.query);
        const list = (v: string | undefined) =>
          v ? z.array(uuid).max(300).parse(v.split(",").filter(Boolean)) : [];
        return {
          draft: await org.draft(c.actor, {
            skipTeamIds: list(q.skipTeamIds),
            skipBotIds: list(q.skipBotIds),
          }),
        };
      }),
    )
    .post(
      "/draft",
      g(async (c) => {
        const { expectedVersion, ...choices } = schemas.draft.parse(c.body);
        return { org: await org.applyDraft(c.actor, expectedVersion, choices) };
      }, 201),
    )
    .post(
      "/presets",
      g(async (c) => {
        const v = schemas.preset.parse(c.body);
        return {
          org: await org.applyPreset(c.actor, v.expectedVersion, v.presetKey, v.underPositionId),
        };
      }, 201),
    );
}

import type { Database } from "@zetta/db";
import { Elysia } from "elysia";
import { z } from "zod";
import { audit } from "../features/audit";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import { installSelection } from "./install";
import { MarketError, parseSource, type Market } from "./market";
import { SKILL_LIMITS, skillFields, SkillError, type Skills } from "./service";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";

export type SkillServices = {
  access: ReturnType<typeof createIdentityAccess>;
  db: Database;
  skills: Skills;
  market: Market;
};
const uuid = z.string().uuid();
const STATUS: Record<SkillError["code"], [number, string]> = {
  NOT_FOUND: [404, "No such skill."],
  FORBIDDEN: [403, "Only an admin can do this."],
  CONFLICT: [409, "This skill changed. Reload and try again."],
  DUPLICATE: [409, "You already have a skill with this name."],
  SECRET_REJECTED: [400, "The skill looks like it holds a secret. Remove it and save again."],
  FULL: [
    409,
    `You reached the limit (${SKILL_LIMITS.perOwner} skills, ${SKILL_LIMITS.perBot} per bot). Remove some first.`,
  ],
};
const MARKET_STATUS: Record<MarketError["code"], [number, string]> = {
  INVALID_SOURCE: [400, "Use owner/repo, a GitHub link or a skills.sh link."],
  NOT_FOUND: [404, "GitHub has no such repository or file."],
  RATE_LIMITED: [429, "GitHub's rate limit was reached. Try again in a few minutes."],
  UNAVAILABLE: [502, "GitHub did not answer. Try again."],
  UNINSTALLABLE: [422, "This skill cannot be installed. See the warnings in the preview."],
};
const source = z.string().trim().min(1).max(300);
const install = z.strictObject({
  source,
  paths: z.array(z.string().min(1).max(300)).min(1).max(25),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  botIds: z.array(uuid).max(SKILL_LIMITS.perOwner).optional(),
});
const patch = z.strictObject({
  expectedVersion: z.number().int().positive(),
  name: skillFields.shape.name.optional(),
  description: skillFields.shape.description.optional(),
  body: skillFields.shape.body.optional(),
});
const bots = z.strictObject({ botIds: z.array(uuid).max(SKILL_LIMITS.perOwner) });

/** The Skills page API. Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type. */
export function createSkillRoutes(
  { access, db, skills, market }: SkillServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  type Ctx = {
    actor: ActiveActor;
    body: unknown;
    params: Record<string, string>;
    query: URLSearchParams;
  };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof SkillError) return fail(STATUS[e.code][0], e.code, STATUS[e.code][1]);
    if (e instanceof MarketError)
      return fail(MARKET_STATUS[e.code][0], e.code, MARKET_STATUS[e.code][1]);
    if (e instanceof z.ZodError)
      return fail(
        400,
        "INVALID_REQUEST",
        e.issues[0]?.message ?? "Check the details and try again.",
      );
    console.error(`skills: unhandled error name=${(e as Error | undefined)?.name ?? typeof e}`);
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
          await work({
            actor: await access.requireActive(request.headers),
            body,
            params,
            query: new URL(request.url).searchParams,
          }),
          status,
        );
      } catch (e) {
        return mapError(e);
      }
    };
  const done = (actor: ActiveActor, detail: string, subjectId?: string) =>
    audit(db, actor.userId, {
      kind: "tool_call",
      outcome: "ok",
      detail,
      subjectId: subjectId ?? null,
    });
  const id = (c: Ctx) => uuid.parse(c.params.id);

  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/skills",
      g(async (c) => ({
        skills: await skills.list(
          c.actor,
          z.enum(["mine", "all"]).parse(c.query.get("scope") ?? "mine"),
        ),
      })),
    )
    .post(
      "/skills",
      g(async (c) => {
        const skill = await skills.create(c.actor, skillFields.parse(c.body));
        await done(c.actor, "skill:create", skill.id);
        return { skill };
      }, 201),
    )
    .get(
      "/skills/market/suggestions",
      g(async () => ({ suggestions: market.suggestions() })),
    )
    .get(
      "/skills/market/search",
      g(async (c) => {
        const q = z
          .string()
          .trim()
          .min(2)
          .max(100)
          .parse(c.query.get("q") ?? "");
        const found = await market.search(q);
        const mine = await skills.installedFrom(c.actor);
        return {
          ...found,
          skills: found.skills.map((k) => ({
            ...k,
            installedId: mine.find((m) => m.repo === k.repo && m.path === k.path)?.id ?? null,
          })),
        };
      }),
    )
    .get(
      "/skills/market/repo",
      g(async (c) => {
        const src = parseSource(source.parse(c.query.get("source") ?? ""));
        if (!src) throw new MarketError("INVALID_SOURCE");
        const found = await market.described(src);
        const mine = await skills.installedFrom(c.actor, found.repo);
        return {
          ...found,
          trust: market.trust(found.repo),
          skills: found.skills.map((k) => ({
            ...k,
            installedId: mine.find((m) => m.path === k.path)?.id ?? null,
          })),
        };
      }),
    )
    .post(
      "/skills/market/install",
      g(async (c) => {
        const input = install.parse(c.body);
        const src = parseSource(input.source);
        if (!src) throw new MarketError("INVALID_SOURCE");
        const result = await installSelection({ skills, market }, c.actor, {
          repo: `${src.owner}/${src.repo}`,
          ref: input.sha,
          paths: input.paths,
          botIds: input.botIds ?? [],
        });
        for (const s of result.installed) await done(c.actor, "skill:install", s.id);
        for (const s of result.attached) await done(c.actor, "skill:attach", s.id);
        return result;
      }, 201),
    )
    .get(
      "/skills/:id",
      g(async (c) => ({ skill: await skills.get(c.actor, id(c)) })),
    )
    .patch(
      "/skills/:id",
      g(async (c) => {
        const { expectedVersion, ...fields } = patch.parse(c.body);
        const skill = await skills.update(c.actor, id(c), expectedVersion, fields);
        await done(c.actor, "skill:edit", skill.id);
        return { skill };
      }),
    )
    .delete(
      "/skills/:id",
      g(async (c) => {
        const r = await skills.archive(c.actor, id(c));
        await done(c.actor, "skill:archive", r.id);
        return { removed: true };
      }),
    )
    .put(
      "/skills/:id/bots",
      g(async (c) => {
        const r = await skills.setBots(c.actor, id(c), bots.parse(c.body).botIds);
        await done(c.actor, "skill:attach", id(c));
        return r;
      }),
    ) as unknown as Elysia<"/api">;
}

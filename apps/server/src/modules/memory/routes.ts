import {
  MEMORY_BOT_ACCESS,
  MEMORY_JOB_PROBLEMS,
  MEMORY_ITEM_STATUSES,
  MEMORY_SCORE_MAX,
  MEMORY_TYPES,
} from "@zetta/db/schema/memory";
import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { IngestError, type MemoryJobs } from "./jobs";
import { assistInput, type MemoryAssist } from "./assist";
import type { MemoryGraphReader } from "./graph";
import { MEMORY_LIMITS, MemoryError, type Memory, type MemoryFilter } from "./service";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";

export type MemoryServices = {
  access: ReturnType<typeof createIdentityAccess>;
  memory: Memory;
  jobs?: MemoryJobs;
  /** Every item and link the person can see, for the graph. */
  graph?: MemoryGraphReader;
  /** One-shot help for the editor, run on the person's chief. */
  assist?: MemoryAssist;
};
/** Per-user times of recent assist calls (each one runs an engine). */
const assistCalls = new Map<string, number[]>();
const ASSIST_PER_MINUTE = 10;
class RateLimited extends Error {}
const STATUS: Record<MemoryError["code"], [number, string]> = {
  SECRET_REJECTED: [400, "The page looks like it holds a secret. Remove it and save again."],
  UNSAFE: [400, "The page looks like an instruction aimed at an AI."],
  CONFLICT: [409, "Someone saved this page in between. Reload it and try again."],
  NOT_FOUND: [404, "No such item, version or suggestion."],
  AMBIGUOUS: [400, "The text is in the item more than once."],
  FULL: [400, `Memory holds ${MEMORY_LIMITS.pages} items. Archive some first.`],
  INVALID: [
    400,
    "An item needs a title and content inside the size limits. Type solo needs one of your bots; type teams needs one or more of your teams.",
  ],
  MANAGED: [
    409,
    "This item holds a Drive document. Its title and text come from Drive and cannot be changed here, and it cannot be shared.",
  ],
  SLUG_TAKEN: [
    409,
    "Another item already uses this name (published by a member, or private to another bot or team). Rename yours.",
  ],
  READ_ONLY: [403, "Bots cannot change this item."],
  TOO_LONG: [
    400,
    `The item would pass ${MEMORY_LIMITS.content} characters. Remove old entries first.`,
  ],
};
const uuid = z.string().uuid();
const text = {
  title: z.string().trim().min(1).max(MEMORY_LIMITS.title),
  howto: z.string().trim().max(MEMORY_LIMITS.howto).default(""),
  content: z.string().trim().min(1).max(MEMORY_LIMITS.content),
  tags: z
    .array(z.string().trim().min(1).max(MEMORY_LIMITS.tag))
    .max(MEMORY_LIMITS.tags)
    .default([]),
};
const meta = {
  type: z.enum(MEMORY_TYPES).optional(),
  teams: z.array(uuid).max(MEMORY_LIMITS.teams).optional(),
  score: z.number().int().min(0).max(MEMORY_SCORE_MAX).optional(),
  authorBotId: uuid.nullable().optional(),
  /** What bots may do with the item: edit it, only suggest changes, or only read it. */
  botAccess: z.enum(MEMORY_BOT_ACCESS).optional(),
};
/** `expectedVersion` is the version the editor started from; 0 for a new item. */
const page = z.strictObject({ ...text, ...meta, expectedVersion: z.number().int().min(0) });
const suggestion = z.strictObject({ ...text, reason: z.string().trim().max(500).default("") });
const change = z.union([
  z.strictObject({ status: z.enum(MEMORY_ITEM_STATUSES) }),
  z.strictObject(meta).refine((m) => Object.values(m).some((x) => x !== undefined)),
]);
const slug = z.string().trim().min(1).max(MEMORY_LIMITS.slug);
const csv = <T extends string>(allowed: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.enum(allowed as [T, ...T[]])).max(12));
const SINCE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 } as const;
/** The facets of GET /api/memory?q=…; a bad value is a 400 (see mapError). */
const searchFilter = z
  .object({
    type: csv(MEMORY_TYPES),
    status: csv(MEMORY_ITEM_STATUSES),
    botAccess: csv(MEMORY_BOT_ACCESS),
    tag: z.string().optional(),
    tagMode: z.enum(["any", "all"]).optional(),
    access: z.enum(["own", "shared"]).optional(),
    by: z.enum(["user", "bot", "system"]).optional(),
    bot: z.string().uuid().optional(),
    createdBy: z.string().uuid().optional(),
    team: z.string().uuid().optional(),
    min: z.coerce.number().int().min(0).max(MEMORY_SCORE_MAX).optional(),
    max: z.coerce.number().int().min(0).max(MEMORY_SCORE_MAX).optional(),
    since: z.enum(["7d", "30d", "90d", "365d"]).optional(),
  })
  .transform((v): MemoryFilter => ({
    ...(v.type.length && { types: v.type }),
    ...(v.status.length && { statuses: v.status }),
    ...(v.botAccess.length && { botAccess: v.botAccess }),
    ...(v.tag && {
      tags: v.tag
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12),
    }),
    ...(v.tagMode && { tagMode: v.tagMode }),
    ...(v.access && { access: v.access }),
    ...(v.by && { by: v.by }),
    ...(v.bot && { botId: v.bot }),
    ...(v.createdBy && { createdByBotId: v.createdBy }),
    ...(v.team && { teamId: v.team }),
    ...(v.min !== undefined && { minScore: v.min }),
    ...(v.max !== undefined && { maxScore: v.max }),
    ...(v.since && { updatedSince: new Date(Date.now() - SINCE_DAYS[v.since] * 86_400_000) }),
  }));
const user = { by: "user" } as const;
/** A source to ingest: an address, pasted text or a file the browser read as text. The size limits are the memory's (`MEMORY_LIMITS.source`). */
const ingest = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("url"),
    url: z.url().max(2000),
    title: z.string().trim().max(160).optional(),
    botId: uuid.optional(),
  }),
  z.strictObject({
    kind: z.literal("text"),
    text: z.string().max(MEMORY_LIMITS.source),
    title: z.string().trim().max(160).optional(),
    botId: uuid.optional(),
  }),
  z.strictObject({
    kind: z.literal("file"),
    name: z.string().trim().min(1).max(200),
    text: z.string().max(MEMORY_LIMITS.source),
    title: z.string().trim().max(160).optional(),
    botId: uuid.optional(),
  }),
]);
const INGEST_FAIL: Record<IngestError["code"], [number, string]> = {
  URL_UNREADABLE: [422, "That page could not be read. Paste its text instead."],
  LIMIT: [429, "Too many sources are being added. Wait for one to finish and try again."],
  NO_ENGINE: [
    409,
    "Adding a source needs a bot with a real engine (your chief, or the bot you pick).",
  ],
};

/** Typed as a bare Elysia on purpose: app.ts chains every module and TypeScript gives up on the combined route type past this size. */
export function createMemoryRoutes(
  { access, memory, jobs, graph, assist }: MemoryServices,
  trustedOrigins: readonly string[],
): Elysia<"/api"> {
  const g =
    (
      work: (c: {
        owner: string;
        params: Record<string, string>;
        query: Record<string, string | undefined>;
        body: unknown;
      }) => Promise<unknown>,
    ) =>
    async ({
      request,
      params,
      query,
      body,
    }: {
      request: Request;
      params: Record<string, string>;
      query: Record<string, string | undefined>;
      body: unknown;
    }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        return out(
          await work({
            owner: (await access.requireActive(request.headers)).userId,
            params,
            query,
            body,
          }),
        );
      } catch (e) {
        if (e instanceof AccessError) return accessFail(e);
        if (e instanceof RateLimited)
          return fail(429, "RATE_LIMITED", "Too many requests. Wait a minute and try again.");
        if (e instanceof MemoryError) return fail(STATUS[e.code][0], e.code, STATUS[e.code][1]);
        if (e instanceof IngestError)
          return fail(INGEST_FAIL[e.code][0], e.code, INGEST_FAIL[e.code][1]);
        if (e instanceof z.ZodError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    };
  // `wiki` is the old name of these routes: the same handlers answer on both so older clients keep working.
  const mount = (n: "memory" | "wiki"): Elysia =>
    new Elysia({ prefix: "/api", normalize: false })
      .get(
        `/${n}`,
        g(async (c) => {
          if (!c.query.q?.trim())
            return { pages: await memory.list(c.owner), shared: await memory.listShared(c.owner) };
          const r = await memory.explore(c.owner, c.query.q, searchFilter.parse(c.query));
          return { pages: r.hits, meaning: r.meaning };
        }),
      )
      .post(
        `/${n}-assist`,
        g(async (c) => {
          if (!assist) throw new MemoryError("NOT_FOUND");
          const input = assistInput.parse(c.body);
          const now = Date.now();
          const recent = (assistCalls.get(c.owner) ?? []).filter((t) => now - t < 60_000);
          if (recent.length >= ASSIST_PER_MINUTE) throw new RateLimited();
          assistCalls.set(c.owner, [...recent, now]);
          return assist(c.owner, input);
        }),
      )
      .get(
        `/${n}-graph`,
        g(async (c) => {
          if (!graph) throw new MemoryError("NOT_FOUND");
          return graph(c.owner);
        }),
      )
      .get(
        `/${n}/:slug`,
        g(async (c) => {
          const r = await memory.read(c.owner, slug.parse(c.params.slug));
          if (!r) throw new MemoryError("NOT_FOUND");
          const p = r.page;
          if (r.access === "shared")
            return {
              access: r.access,
              ownerName: r.ownerName,
              page: p,
              linkedFrom: r.linkedFrom,
              links: r.links,
            };
          return {
            access: r.access,
            page: p,
            linkedFrom: r.linkedFrom,
            links: r.links,
            history: await memory.history(c.owner, p.slug),
            sources: await memory.sources(c.owner, p.slug),
            raw: await memory.rawInfo(c.owner, p.id),
          };
        }),
      )
      .put(
        `/${n}/:slug`,
        g(async (c) => {
          const v = page.parse(c.body);
          const r = await memory.write(c.owner, { slug: slug.parse(c.params.slug), ...v }, user);
          return { slug: r.page.slug, version: r.page.version, created: r.created };
        }),
      )
      .patch(
        `/${n}/:slug`,
        g(async (c) => {
          const v = change.parse(c.body);
          const key = slug.parse(c.params.slug);
          if (!("status" in v)) {
            const p = await memory.setMeta(c.owner, key, v, user);
            return {
              slug: p.slug,
              version: p.version,
              type: p.type,
              score: p.score,
              botAccess: p.botAccess,
            };
          }
          const r = await memory.setStatus(c.owner, key, v.status, user);
          return { slug: r.page.slug, version: r.page.version, status: r.page.status };
        }),
      )
      .post(
        `/${n}-conventions`,
        g(async (c) => ({ ...(await memory.ensureConventions(c.owner)) })),
      )
      .post(
        `/${n}/:slug/restore`,
        g(async (c) => {
          const v = z.strictObject({ version: z.number().int().min(1) }).parse(c.body);
          const r = await memory.restore(c.owner, slug.parse(c.params.slug), v.version, user);
          return { slug: r.page.slug, version: r.page.version };
        }),
      )
      .post(
        `/${n}/:slug/suggestions`,
        g(async (c) => {
          const v = suggestion.parse(c.body);
          const r = await memory.suggest(c.owner, slug.parse(c.params.slug), v, user);
          return { id: r.suggestion.id, status: r.suggestion.status };
        }),
      )
      .get(
        `/${n}/:slug/graph`,
        g(async (c) => {
          const depth = Math.min(Math.max(Number(c.query.depth) || 1, 1), 2);
          return memory.neighbors(c.owner, slug.parse(c.params.slug), depth);
        }),
      )
      .get(
        `/${n}-suggestions`,
        g(async (c) => memory.suggestions(c.owner)),
      )
      .post(
        `/${n}-suggestions/:id/decision`,
        g(async (c) => {
          const v = z.strictObject({ decision: z.enum(["accept", "reject"]) }).parse(c.body);
          return memory.decide(c.owner, uuid.parse(c.params.id), v.decision);
        }),
      )
      .delete(
        `/${n}-suggestions/:id`,
        g(async (c) => {
          await memory.withdraw(c.owner, uuid.parse(c.params.id));
          return { status: "withdrawn" };
        }),
      )
      .get(
        `/${n}-checks`,
        g(async (c) => ({
          checks: await memory.checks(c.owner),
          jobs: jobs ? await jobs.recent(c.owner) : [],
        })),
      )
      .post(
        `/${n}-review`,
        g(async (c) => {
          if (!jobs) throw new MemoryError("NOT_FOUND");
          const v = z
            .strictObject({ problem: z.enum(MEMORY_JOB_PROBLEMS).default("all") })
            .parse(c.body ?? {});
          const j = await jobs.requestReview(c.owner, v.problem);
          return { id: j.id, status: j.status, conversationId: j.conversationId };
        }),
      ) as never;
  // Adding a source: its own small route set, because one chain for all of the memory is already at the limit of what TypeScript can type.
  const mountIngest = (n: "memory" | "wiki"): Elysia =>
    new Elysia({ prefix: "/api", normalize: false })
      .post(
        `/${n}-ingest`,
        g(async (c) => {
          if (!jobs) throw new MemoryError("NOT_FOUND");
          const { botId, ...input } = ingest.parse(c.body);
          const r = await jobs.requestIngest(c.owner, input, botId);
          return {
            jobId: r.job.id,
            status: r.job.status,
            conversationId: r.job.conversationId,
            slug: r.slug,
            existing: r.existing,
            screen: r.job.screen,
          };
        }),
      )
      .post(
        `/${n}-ingest/:jobId/force`,
        g(async (c) => {
          if (!jobs) throw new MemoryError("NOT_FOUND");
          const j = await jobs.forceIngest(c.owner, uuid.parse(c.params.jobId));
          return { jobId: j.id, status: j.status, conversationId: j.conversationId };
        }),
      ) as never;
  const routes = new Elysia({ normalize: false })
    .use(mount("memory"))
    .use(mount("wiki"))
    .use(mountIngest("memory"))
    .use(mountIngest("wiki"));
  return routes as never;
}

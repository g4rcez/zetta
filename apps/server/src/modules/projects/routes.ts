import { PROJECT_BRIEF_MAX, PROJECT_STATUSES, PROJECT_WATCH } from "@zetta/db/schema/projects";
import { Elysia } from "elysia";
import { z } from "zod";
import { NotReadyError } from "../chat/service";
import { accessFail, createGuardedRoute, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { AgentsPausedError } from "../preferences/agents-state";
import { TaskRuleError } from "../tasks/follow-up";
import { draftInput, type ProjectDraft } from "./draft";
import { ProjectRuleError, type ProjectStore } from "./store";
import { workInput, type ProjectWork } from "./work";

export type ProjectServices = {
  access: ReturnType<typeof createIdentityAccess>;
  projects: ProjectStore;
  /** Hands work to a bot or a person. Absent in tests that only read and write projects. */
  work?: ProjectWork;
  /** Drafts a brief with the person's chief. Absent when no engine is wired. */
  draft?: ProjectDraft;
};

const answer = z.string().trim().max(PROJECT_BRIEF_MAX);
/** Labels are free text: lowercase, trimmed, no repeats. */
const labels = z
  .array(z.string().trim().min(1).max(32))
  .max(10)
  .transform((all) => [...new Set(all.map((l) => l.toLowerCase()))]);
const fields = {
  outcome: answer.optional(),
  audience: answer.optional(),
  doneWhen: answer.optional(),
  notIncluded: answer.optional(),
  labels: labels.optional(),
  watch: z.enum(PROJECT_WATCH).optional(),
};
const name = z.string().trim().min(1).max(120);
const botIds = z.array(z.string().uuid()).max(30);
const userIds = z.array(z.string().min(1).max(200)).max(30);
const create = z.strictObject({
  name,
  ...fields,
  bots: botIds.optional(),
  people: userIds.optional(),
});
const patch = z.strictObject({
  name: name.optional(),
  ...fields,
  status: z.enum(PROJECT_STATUSES).optional(),
});
const members = z.strictObject({ bots: botIds, people: userIds });
const rooms = z.strictObject({ rooms: z.array(z.string().uuid()).max(30) });

/** Per-user times of recent drafts (each one runs an engine). */
const draftCalls = new Map<string, number[]>();
const DRAFTS_PER_MINUTE = 6;
class RateLimited extends Error {}

export function createProjectRoutes(
  { access, projects, work, draft }: ProjectServices,
  trustedOrigins: readonly string[],
) {
  type Ctx = { params: Record<string, string> };
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof ProjectRuleError) return fail(409, e.code, e.message);
    if (e instanceof TaskRuleError) return fail(409, e.code, e.message);
    if (e instanceof AgentsPausedError)
      return fail(409, "AGENTS_PAUSED", "Your agents are paused. Resume them first.");
    if (e instanceof NotReadyError)
      return fail(409, "NOT_READY", "This bot is not set up yet. Open its chat to finish.");
    if (e instanceof RateLimited)
      return fail(429, "TOO_MANY", "That was a lot of drafts. Wait a minute and try again.");
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g = createGuardedRoute({ access, trustedOrigins, mapError });
  const id = (c: Ctx) => z.string().uuid().parse(c.params.id);
  return new Elysia({ prefix: "/api", normalize: false })
    .get(
      "/projects",
      g(async (c) => {
        const [list, unfiled] = await Promise.all([
          projects.list(c.actor),
          projects.unfiled(c.actor),
        ]);
        return { projects: list, unfiled };
      }),
    )
    .get(
      "/projects/candidates",
      g(async (c) => projects.candidates(c.actor)),
    )
    .post(
      "/projects",
      g(async (c) => ({ project: await projects.create(c.actor, create.parse(c.body)) }), 201),
    )
    .post(
      "/projects/draft",
      g(async (c) => {
        const input = draftInput.parse(c.body);
        if (!draft) return { kind: "unavailable", reason: "No engine is set up to draft this." };
        const now = Date.now();
        const recent = (draftCalls.get(c.actor.userId) ?? []).filter((t) => now - t < 60_000);
        if (recent.length >= DRAFTS_PER_MINUTE) throw new RateLimited();
        draftCalls.set(c.actor.userId, [...recent, now]);
        return draft(c.actor.userId, input);
      }),
    )
    .get(
      "/projects/:id",
      g(async (c) => ({ project: await projects.get(c.actor, id(c)) })),
    )
    .patch(
      "/projects/:id",
      g(async (c) => ({ project: await projects.update(c.actor, id(c), patch.parse(c.body)) })),
    )
    .put(
      "/projects/:id/members",
      g(async (c) => ({
        project: await projects.setMembers(c.actor, id(c), members.parse(c.body)),
      })),
    )
    .put(
      "/projects/:id/rooms",
      g(async (c) => ({
        project: await projects.setRooms(c.actor, id(c), rooms.parse(c.body).rooms),
      })),
    )
    .post(
      "/projects/:id/work",
      g(async (c) => {
        const input = workInput.parse(c.body);
        if (!work) throw new AccessError("NOT_FOUND");
        return work(c.actor, id(c), input);
      }, 201),
    );
}

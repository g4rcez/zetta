import { and, eq, inArray, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { configProposal } from "@zetta/db/schema/features";
import { discussion } from "@zetta/db/schema/discussions";

import { pick, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

type Member = {
  botId: string;
  kind: "chief" | "member";
  roleId: string | null;
  canvas: { x: number; y: number };
};

export async function runTeam(ctx: ChiefCtx, a: ChiefArgs<"team">): Promise<Outcome> {
  const { teams, db } = ctx.deps;
  if (!teams) return { error: "teams are not available on this server." };
  const roles = await teams.roles(ctx.actor);
  if (a.action === "role_create")
    return {
      plan: {
        title: `New team role ${a.name}`,
        diff: [
          { field: "name", from: null, to: a.name },
          { field: "description", from: null, to: a.description },
          { field: "color", from: null, to: a.color ?? "slate" },
          { field: "icon", from: null, to: a.icon ?? "user" },
        ],
        patch: {
          tool: "team",
          op: "role_create",
          input: {
            name: a.name,
            description: a.description,
            color: a.color ?? "slate",
            icon: a.icon ?? "user",
          },
        },
      },
    };
  if (a.action === "role_update" || a.action === "role_remove") {
    const r = pick(roles, a.role, (x) => x.name, "team role");
    if ("error" in r) return r;
    if (a.action === "role_remove")
      return {
        plan: {
          title: `Delete team role ${r.hit.name}`,
          diff: [{ field: "delete role", from: r.hit.name, to: "members who had it keep no role" }],
          patch: { tool: "team", op: "role_remove", id: r.hit.id },
        },
      };
    const input = {
      name: r.hit.name,
      description: r.hit.description,
      color: r.hit.color,
      icon: r.hit.icon,
    };
    const diff: DiffLine[] = [{ field: "role", from: null, to: r.hit.name }];
    for (const k of ["name", "description", "color", "icon"] as const) {
      const to = a[k];
      if (to === undefined || to === input[k]) continue;
      diff.push({ field: k, from: input[k], to });
      (input as Record<string, unknown>)[k] = to;
    }
    if (diff.length === 1) return { error: `"${r.hit.name}" already has those values.` };
    return {
      plan: {
        title: `Change team role ${r.hit.name}`,
        diff,
        patch: { tool: "team", op: "role_update", id: r.hit.id, input },
      },
    };
  }

  const all = await teams.list(ctx.actor);
  if (a.action === "list")
    return {
      read: `team.list:\n${JSON.stringify({ teams: all.map((t) => ({ id: t.id, name: t.name, goal: t.goal, context: t.context.slice(0, 400), version: t.version, members: t.members.map((m) => ({ bot: m.name, botId: m.botId, kind: m.kind, role: m.role })) })), roles: roles.map((r) => ({ id: r.id, name: r.name, description: r.description })) })}`,
    };
  const f = pick(all, a.team, (x) => x.name, "team");
  if ("error" in f) return f;
  const t = f.hit;
  if (a.action === "archive")
    return {
      plan: {
        title: `Archive team ${t.name}`,
        diff: [{ field: "archive team", from: t.name, to: "archived; its rooms and chats stay" }],
        patch: { tool: "team", op: "archive", id: t.id },
      },
    };

  if (a.action === "open_room") {
    if (t.members.length < 2)
      return { error: `"${t.name}" has no bot besides its chief yet. Add the team's bots first.` };
    const [taken] = await db
      .select({ id: discussion.id })
      .from(discussion)
      .where(
        and(
          eq(discussion.ownerUserId, ctx.actor.userId),
          sql`${discussion.teamId} is not null`,
          sql`lower(${discussion.title}) = lower(${a.title})`,
          inArray(discussion.status, ["open", "paused", "stalled"]),
        ),
      );
    if (taken)
      return { error: `A team room called "${a.title}" already exists. Use another title.` };
    return {
      plan: {
        title: `Open room "${a.title}" for team ${t.name}`,
        diff: [
          { field: "team", from: null, to: t.name },
          { field: "room", from: null, to: a.title },
          { field: "goal", from: null, to: short(a.goal) },
          ...(a.context ? [{ field: "context", from: null, to: short(a.context) }] : []),
          { field: "starts", from: null, to: "waits: nobody is woken until you write in it" },
        ],
        patch: {
          tool: "team",
          op: "open_room",
          id: t.id,
          input: { title: a.title, goal: a.goal, ...(a.context ? { context: a.context } : {}) },
        },
      },
    };
  }

  // Two pending updates of one team would both carry the same version: the second fails once the first is approved.
  if (a.action === "update") {
    const [waiting] = await db
      .select({ id: configProposal.id })
      .from(configProposal)
      .where(
        and(
          eq(configProposal.ownerUserId, ctx.actor.userId),
          eq(configProposal.status, "pending"),
          sql`${configProposal.patch}->>'tool' = 'team'`,
          sql`${configProposal.patch}->>'op' = 'update'`,
          sql`${configProposal.patch}->>'id' = ${t.id}`,
        ),
      );
    if (waiting)
      return {
        error: `A change to "${t.name}" already waits for the user's approval. Send the next change to this team after it is decided.`,
      };
  }

  // update: work out the full member list, because save() replaces it.
  const bots = await db
    .select()
    .from(bot)
    .where(and(eq(bot.ownerUserId, ctx.actor.userId), eq(bot.archived, false)));
  const roleOf = (name: string) =>
    name ? pick(roles, name, (x) => x.name, "team role") : ({ hit: null } as const);
  const members: Member[] = t.members.map(({ botId, kind, roleId, canvas }) => ({
    botId,
    kind,
    roleId,
    canvas,
  }));
  const diff: DiffLine[] = [{ field: "team", from: null, to: t.name }];
  for (const q of a.remove ?? []) {
    const m = pick(
      t.members.map((x) => ({ ...x, id: x.botId })),
      q,
      (x) => x.name,
      "member",
    );
    if ("error" in m) return m;
    if (m.hit.kind === "chief")
      return { error: `${m.hit.name} leads the team and cannot be removed.` };
    const i = members.findIndex((x) => x.botId === m.hit.botId);
    if (i >= 0) members.splice(i, 1);
    diff.push({ field: "remove member", from: m.hit.name, to: null });
  }
  for (const c of a.roles ?? []) {
    const m = pick(
      t.members.map((x) => ({ ...x, id: x.botId })),
      c.bot,
      (x) => x.name,
      "member",
    );
    if ("error" in m) return m;
    const role = roleOf(c.role);
    if ("error" in role) return role;
    const mem = members.find((x) => x.botId === m.hit.botId);
    if (!mem) return { error: `${m.hit.name} was removed in this same change.` };
    mem.roleId = role.hit?.id ?? null;
    diff.push({
      field: "role",
      from: m.hit.role || null,
      to: `${m.hit.name}: ${role.hit?.name ?? "no role"}`,
    });
  }
  for (const c of a.add ?? []) {
    const b = pick(bots, c.bot, (x) => x.name, "bot");
    if ("error" in b) return b;
    if (members.some((x) => x.botId === b.hit.id)) continue;
    const role = roleOf(c.role);
    if ("error" in role) return role;
    const n = members.length;
    members.push({
      botId: b.hit.id,
      kind:
        b.hit.id === ctx.who.id && !members.some((x) => x.kind === "chief") ? "chief" : "member",
      roleId: role.hit?.id ?? null,
      canvas: { x: 20 + (n % 3) * 110, y: 40 + Math.floor(n / 3) * 90 },
    });
    diff.push({
      field: "add member",
      from: null,
      to: `${b.hit.name}${role.hit ? ` (${role.hit.name})` : ""}`,
    });
  }
  // save() needs exactly one chief; a team without one gets this chief.
  if (members.length && !members.some((x) => x.kind === "chief"))
    members.unshift({ botId: ctx.who.id, kind: "chief", roleId: null, canvas: { x: 20, y: 40 } });
  const input: Record<string, unknown> = {
    name: a.name ?? t.name,
    goal: a.goal ?? t.goal,
    ...(a.context !== undefined ? { context: a.context } : {}),
    canvas: {
      ...t.canvas,
      h: Math.max(t.canvas.h, 80 + (Math.floor(members.length / 3) + 1) * 90),
    },
    members,
  };
  for (const k of ["name", "goal", "context"] as const) {
    const to = a[k];
    const from = k === "context" ? ((t as { context?: string }).context ?? "") : t[k];
    if (to !== undefined && to !== from) diff.push({ field: k, from: short(from), to: short(to) });
  }
  if (diff.length === 1) return { error: `Nothing changes in "${t.name}".` };
  return {
    plan: {
      title: `Change team ${t.name}`,
      diff,
      patch: { tool: "team", op: "update", id: t.id, input, expectedVersion: t.version },
      baseVersion: t.version,
    },
  };
}

export async function applyTeam(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const { teams } = ctx.deps;
  if (!teams) throw new Error("teams unavailable");
  const v = p as {
    op: string;
    id: string;
    input: never;
    expectedVersion: number;
  };
  if (v.op === "update") await teams.save(ctx.actor, v.id, v.expectedVersion, v.input);
  else if (v.op === "archive") await teams.archive(ctx.actor, v.id);
  else if (v.op === "open_room") await teams.startRoom(ctx.actor, v.id, v.input);
  else if (v.op === "role_create") await teams.createRole(ctx.actor, v.input);
  else if (v.op === "role_update") await teams.updateRole(ctx.actor, v.id, v.input);
  else await teams.deleteRole(ctx.actor, v.id);
}

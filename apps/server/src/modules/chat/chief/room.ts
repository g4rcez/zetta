import { and, eq, inArray } from "@zetta/db/query";
import { discussion } from "@zetta/db/schema/discussions";

import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** Rooms the user already has (pause, resume, cancel, silence the bots, who needs approval) and which bots may open rooms freely. */
export async function runRoom(ctx: ChiefCtx, a: ChiefArgs<"room">): Promise<Outcome> {
  const { discussions, teams, db } = ctx.deps;
  if (!discussions) return { error: "rooms are not available on this server." };
  const bots = await owned(ctx);
  if (a.action === "peers") {
    const b = pick(bots, a.bot, (x) => x.name, "bot");
    if ("error" in b) return b;
    const peers: { id: string; name: string }[] = [];
    for (const q of a.peers) {
      const p = pick(bots, q, (x) => x.name, "bot");
      if ("error" in p) return p;
      if (p.hit.id !== b.hit.id) peers.push(p.hit);
    }
    return plan(
      `Let ${b.hit.name} open rooms with ${peers.length ? peers.map((p) => p.name).join(", ") : "no bot"} without asking`,
      [
        { field: "bot", from: null, to: b.hit.name },
        { field: "peers", from: null, to: peers.map((p) => p.name).join(", ") || "(none)" },
      ],
      { tool: "room", op: "peers", botId: b.hit.id, ids: peers.map((p) => p.id) },
    );
  }
  const rows = await db
    .select({ id: discussion.id, title: discussion.title, status: discussion.status })
    .from(discussion)
    .where(
      and(
        eq(discussion.ownerUserId, ctx.actor.userId),
        eq(discussion.kind, "room"),
        inArray(discussion.status, ["open", "paused", "stalled"]),
      ),
    );
  if (a.action === "list") return { read: `room.list:\n${JSON.stringify(rows)}` };
  const r = pick(rows, a.room, (x) => x.title, "room");
  if ("error" in r) return r;
  const room = { field: "room", from: null as unknown, to: r.hit.title as unknown };
  if (a.action === "require_approval") {
    const b = pick(bots, a.bot, (x) => x.name, "bot");
    if ("error" in b) return b;
    return plan(
      `${a.on ? "Ask" : "Stop asking"} for approval before ${b.hit.name} speaks in ${r.hit.title}`,
      [
        room,
        { field: "bot", from: null, to: b.hit.name },
        { field: "needs approval", from: a.on ? "no" : "yes", to: a.on ? "yes" : "no" },
      ],
      { tool: "room", op: "approval", id: r.hit.id, botId: b.hit.id, on: a.on },
    );
  }
  if (a.action === "set_team") {
    if (!teams) return { error: "teams are not available on this server." };
    let team: { id: string; name: string } | null = null;
    if (a.team !== null) {
      const t = pick(await teams.list(ctx.actor), a.team, (x) => x.name, "team");
      if ("error" in t) return t;
      team = t.hit;
    }
    return plan(
      `Move ${r.hit.title} to ${team?.name ?? "no team"}`,
      [room, { field: "team", from: null, to: team?.name ?? "(none)" }],
      { tool: "room", op: "team", id: r.hit.id, teamId: team?.id ?? null },
    );
  }
  const text = {
    pause: "Pause the room",
    resume: "Resume the room",
    cancel: "Cancel the room for good",
    silence: "Silence every bot in the room and end their goals",
    stop_goals: "End the goals the bots work on in the room",
  }[a.action];
  return plan(`${text}: ${r.hit.title}`, [room, { field: "do", from: null, to: text }], {
    tool: "room",
    op: a.action,
    id: r.hit.id,
  });
}

export async function applyRoom(
  ctx: ChiefCtx | ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  const { discussions, teams } = ctx.deps;
  if (!discussions) throw new Error("rooms unavailable");
  const v = p as {
    op: string;
    id: string;
    botId: string;
    on: boolean;
    ids: string[];
    teamId: string | null;
  };
  const who = ctx.actor;
  if (v.op === "peers") await discussions.setPeers(who, v.botId, v.ids);
  else if (v.op === "approval") await discussions.setRequireApproval(who, v.id, v.botId, v.on);
  else if (v.op === "team") {
    if (!teams) throw new Error("teams unavailable");
    await teams.setRoomTeam(who, v.id, v.teamId);
  } else if (v.op === "silence") await discussions.silence(who, v.id);
  else if (v.op === "stop_goals") await discussions.stopGoals(who, v.id);
  else await discussions.setStatus(who, v.id, v.op as "pause" | "resume" | "cancel");
}

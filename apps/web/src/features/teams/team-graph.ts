import type { Node } from "@xyflow/react";
import type { Team, TeamKind, TeamMember, TeamSave } from "./teams-api";

/** The teams canvas: one `team` group node per team and one `bot` node per member, placed inside the group (`parentId`). */
export type TeamData = { teamId: string; name: string; goal: string; version: number } & Record<
  string,
  unknown
>;
export type BotData = {
  botId: string;
  name: string;
  kind: TeamKind;
  roleId: string | null;
} & Record<string, unknown>;
export type TeamNode = Node<TeamData, "team">;
export type BotNode = Node<BotData, "bot">;
export type TeamsNode = TeamNode | BotNode;
export type Box = { x: number; y: number; w: number; h: number };

export const teamNodeId = (teamId: string) => `team:${teamId}`;
export const botNodeId = (teamId: string, botId: string) => `${teamId}:${botId}`;
export const BOT_SIZE = { w: 190, h: 56 };
export const TEAM_DEFAULT_SIZE = { w: 440, h: 280 };
const PAD = 16;
const GAP = 12;
const HEADER_H = 40;
const GOAL_H = 40;
const MIN_TEAM_H = 180;

/**
 * Bots sit in a grid under the title bar: the chief first, then the others in the order of their position (so a drag reorders them).
 * The grid is centered, its columns follow the group width, and the group height grows to hold every row.
 */
export function arrange(nodes: TeamsNode[]): TeamsNode[] {
  const moved = new Map<string, TeamsNode>();
  for (const team of nodes) {
    if (team.type !== "team") continue;
    const members = nodes.filter((n): n is BotNode => n.type === "bot" && n.parentId === team.id);
    if (members.length === 0) continue;
    const w = team.width ?? TEAM_DEFAULT_SIZE.w;
    const top = HEADER_H + (team.data.goal ? GOAL_H : 0) + PAD / 2;
    const cols = Math.max(1, Math.floor((w - 2 * PAD + GAP) / (BOT_SIZE.w + GAP)));
    const left = Math.max(PAD, Math.round((w - (cols * BOT_SIZE.w + (cols - 1) * GAP)) / 2));
    const row = (b: BotNode) => Math.round((b.position.y - top) / (BOT_SIZE.h + GAP));
    const ordered = [...members].sort(
      (a, b) =>
        Number(b.data.kind === "chief") - Number(a.data.kind === "chief") ||
        row(a) - row(b) ||
        a.position.x - b.position.x,
    );
    ordered.forEach((b, i) =>
      moved.set(b.id, {
        ...b,
        position: {
          x: left + (i % cols) * (BOT_SIZE.w + GAP),
          y: top + Math.floor(i / cols) * (BOT_SIZE.h + GAP),
        },
      }),
    );
    const rows = Math.ceil(members.length / cols);
    moved.set(team.id, {
      ...team,
      width: w,
      height: Math.max(MIN_TEAM_H, top + rows * (BOT_SIZE.h + GAP) - GAP + PAD),
    });
  }
  return nodes.map((n) => moved.get(n.id) ?? n);
}

const botNode = (
  teamId: string,
  m: Pick<TeamMember, "botId" | "name" | "kind" | "roleId" | "canvas">,
): BotNode => ({
  id: botNodeId(teamId, m.botId),
  type: "bot",
  parentId: teamNodeId(teamId),
  position: m.canvas,
  data: { botId: m.botId, name: m.name, kind: m.kind, roleId: m.roleId },
});

/** Group nodes come first: React Flow needs a parent before its children. */
export function teamsToFlow(teams: Team[]): TeamsNode[] {
  return [
    ...teams.map((t): TeamNode => ({
      id: teamNodeId(t.id),
      type: "team",
      position: { x: t.canvas.x, y: t.canvas.y },
      width: t.canvas.w,
      height: t.canvas.h,
      data: { teamId: t.id, name: t.name, goal: t.goal, version: t.version },
      dragHandle: ".team-handle",
    })),
    ...teams.flatMap((t) => t.members.map((m) => botNode(t.id, m))),
  ];
}

/** One save body per team, read back from the canvas. */
export function flowToTeams(nodes: TeamsNode[]): { id: string; save: TeamSave }[] {
  return nodes
    .filter((n): n is TeamNode => n.type === "team")
    .map((t) => ({
      id: t.data.teamId,
      save: {
        expectedVersion: t.data.version,
        name: t.data.name,
        goal: t.data.goal,
        canvas: {
          x: Math.round(t.position.x),
          y: Math.round(t.position.y),
          w: Math.round(t.width ?? 360),
          h: Math.round(t.height ?? 280),
        },
        members: nodes
          .filter((n): n is BotNode => n.type === "bot" && n.parentId === t.id)
          .map((b) => ({
            botId: b.data.botId,
            kind: b.data.kind,
            roleId: b.data.roleId,
            canvas: { x: Math.round(b.position.x), y: Math.round(b.position.y) },
          })),
      },
    }));
}

/** The top-most group that holds the point (later nodes sit above earlier ones). */
export function dropTarget(
  point: { x: number; y: number },
  groups: { id: string; x: number; y: number; w: number; h: number }[],
): string | undefined {
  return [...groups]
    .reverse()
    .find((g) => point.x >= g.x && point.x <= g.x + g.w && point.y >= g.y && point.y <= g.y + g.h)
    ?.id;
}

export const groupsOf = (nodes: TeamsNode[]) =>
  nodes
    .filter((n): n is TeamNode => n.type === "team")
    .map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      w: n.width ?? 360,
      h: n.height ?? 280,
    }));

/** Every team with bots has exactly one chief: the first bot takes the role when it is missing, and extra chiefs become members. */
export function normalizeChiefs(nodes: TeamsNode[]): TeamsNode[] {
  const chief = new Map<string, string>();
  for (const n of nodes)
    if (n.type === "bot" && n.parentId && n.data.kind === "chief" && !chief.has(n.parentId))
      chief.set(n.parentId, n.id);
  for (const n of nodes)
    if (n.type === "bot" && n.parentId && !chief.has(n.parentId)) chief.set(n.parentId, n.id);
  return nodes.map((n) =>
    n.type === "bot" && n.parentId
      ? { ...n, data: { ...n.data, kind: chief.get(n.parentId) === n.id ? "chief" : "member" } }
      : n,
  );
}

export const makeChief = (nodes: TeamsNode[], id: string): TeamsNode[] => {
  const parent = nodes.find((n) => n.id === id)?.parentId;
  return arrange(
    nodes.map((n) =>
      n.type === "bot" && n.parentId === parent
        ? { ...n, data: { ...n.data, kind: n.id === id ? "chief" : "member" } }
        : n,
    ),
  );
};

/** Takes a bot out of its team; a removed chief passes the role on. */
export const removeBot = (nodes: TeamsNode[], id: string): TeamsNode[] =>
  arrange(normalizeChiefs(nodes.filter((n) => n.id !== id)));

/** Puts a bot in a team at a position inside the group. Returns the same nodes when the team already has that bot. */
export function addBot(
  nodes: TeamsNode[],
  teamNode: string,
  bot: { botId: string; name: string },
  position: { x: number; y: number },
  roleId: string | null = null,
): TeamsNode[] {
  const teamId = (nodes.find((n) => n.id === teamNode) as TeamNode | undefined)?.data.teamId;
  if (!teamId) return nodes;
  const inTeam = nodes.filter((n) => n.type === "bot" && n.parentId === teamNode);
  if (inTeam.some((n) => (n as BotNode).data.botId === bot.botId)) return nodes;
  return arrange(
    normalizeChiefs([
      ...nodes,
      botNode(teamId, {
        botId: bot.botId,
        name: bot.name,
        kind: "member",
        roleId,
        canvas: position,
      }),
    ]),
  );
}

/**
 * A bot node was dropped with its top-left corner at `abs` (flow coordinates): it stays in its group, moves to the group it landed in, or leaves its team
 * when it landed outside every group.
 */
export function dropBot(
  nodes: TeamsNode[],
  id: string,
  abs: { x: number; y: number },
): TeamsNode[] {
  const node = nodes.find((n): n is BotNode => n.id === id && n.type === "bot");
  if (!node) return nodes;
  const groups = groupsOf(nodes);
  const target = dropTarget({ x: abs.x + BOT_SIZE.w / 2, y: abs.y + BOT_SIZE.h / 2 }, groups);
  if (target === node.parentId) return arrange(nodes);
  const rest = nodes.filter((n) => n.id !== id);
  const dest = groups.find((g) => g.id === target);
  if (!dest) return arrange(normalizeChiefs(rest));
  return addBot(
    arrange(normalizeChiefs(rest)),
    dest.id,
    { botId: node.data.botId, name: node.data.name },
    { x: abs.x - dest.x, y: abs.y - dest.y },
    node.data.roleId,
  );
}

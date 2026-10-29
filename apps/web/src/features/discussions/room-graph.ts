import type { Edge, Node } from "@xyflow/react";
import type { TeamKind } from "../teams/teams-api";
import type { DiscussionMember, RoomTask, RoomTaskStatus, RoomTurn } from "./discussions-api";

export type MemberState = "idle" | "queued" | "running" | "done" | "failed";
export type MemberData = {
  botId: string;
  name: string;
  role: string;
  kind: TeamKind;
  state: MemberState;
  /** The newest step of the bot's latest turn. */ lastStep: string;
  tasks: { counts: Partial<Record<RoomTaskStatus, number>>; open: string[] };
} & Record<string, unknown>;
export type MemberNode = Node<MemberData, "member">;

export const NODE_W = 220,
  GAP = 40,
  ROW = 230;

const STATE: Partial<Record<RoomTurn["status"], MemberState>> = {
  running: "running",
  queued: "queued",
  awaiting_approval: "queued",
  done: "done",
  failed: "failed",
};

/** The chief on top, the members in a row below it, one edge from the chief to each member. `turns` are newest first. */
export function roomToFlow(
  members: DiscussionMember[],
  chiefId: string | null,
  turns: RoomTurn[],
  tasks: RoomTask[],
): { nodes: MemberNode[]; edges: Edge[] } {
  const chief = members.find((m) => m.botId === chiefId) ?? members[0];
  const others = members.filter((m) => m !== chief);
  const width = Math.max(others.length, 1) * (NODE_W + GAP) - GAP;
  const build = (m: DiscussionMember, x: number, y: number): MemberNode => {
    const latest = turns.find((t) => t.botId === m.botId);
    const mine = tasks.filter((t) => t.botId === m.botId);
    return {
      id: m.botId,
      type: "member",
      position: { x, y },
      data: {
        botId: m.botId,
        name: m.name,
        role: m.role,
        kind: m === chief ? "chief" : "member",
        state: (latest && STATE[latest.status]) ?? "idle",
        lastStep: latest?.steps.at(-1)?.label ?? "",
        tasks: {
          counts: mine.reduce<Partial<Record<RoomTaskStatus, number>>>(
            (c, t) => ({ ...c, [t.status]: (c[t.status] ?? 0) + 1 }),
            {},
          ),
          open: mine
            .filter((t) => t.status !== "done")
            .slice(0, 3)
            .map((t) => t.title),
        },
      },
    };
  };
  const nodes = [
    ...(chief ? [build(chief, (width - NODE_W) / 2, 0)] : []),
    ...others.map((m, i) => build(m, i * (NODE_W + GAP), ROW)),
  ];
  return {
    nodes,
    edges: chief
      ? others.map((m) => ({
          id: `${chief.botId}:${m.botId}`,
          source: chief.botId,
          target: m.botId,
          animated: nodes.find((n) => n.id === m.botId)?.data.state === "running",
        }))
      : [],
  };
}

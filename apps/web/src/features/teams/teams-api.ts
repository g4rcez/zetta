import { call } from "../chat/chat-client";

/** Past this many bots a team still works, but every turn carries more context (see TEAM_SIZE_WARNING). */
export const TEAM_SIZE_WARNING_AT = 6;
export const TEAM_SIZE_WARNING = "More bots, more context and tokens consumption.";
export const TEAM_KINDS = ["chief", "member"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];
export type TeamBox = { x: number; y: number; w: number; h: number };
export type TeamPoint = { x: number; y: number };
export type TeamMember = {
  botId: string;
  name: string;
  kind: TeamKind;
  role: string;
  canvas: TeamPoint;
};
export type Team = {
  id: string;
  name: string;
  goal: string;
  canvas: TeamBox;
  version: number;
  members: TeamMember[];
};
export type TeamSave = {
  expectedVersion: number;
  name: string;
  goal: string;
  canvas: TeamBox;
  members: Omit<TeamMember, "name">[];
};

export const teamsApi = {
  list: () => call<{ teams: Team[] }>("/api/teams").then((r) => r.teams),
  get: (id: string) => call<{ team: Team }>(`/api/teams/${id}`).then((r) => r.team),
  create: (name: string, canvas: TeamBox) =>
    call<{ team: Team }>("/api/teams", "POST", { name, canvas }).then((r) => r.team),
  save: (id: string, v: TeamSave) =>
    call<{ team: Team }>(`/api/teams/${id}`, "PUT", v).then((r) => r.team),
  archive: (id: string) => call(`/api/teams/${id}`, "DELETE"),
  startRoom: (id: string, v: { title: string; firstMessage: string; goal?: string }) =>
    call<{ discussionId: string }>(`/api/teams/${id}/rooms`, "POST", v).then((r) => r.discussionId),
};

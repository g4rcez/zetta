import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";
import { STATIC } from "@/lib/query-policy";

/** Past this many bots a team still works, but every turn carries more context (see TEAM_SIZE_WARNING). */
export const TEAM_SIZE_WARNING_AT = 6;
export const TEAM_SIZE_WARNING = "More bots, more context and tokens consumption.";
export const TEAM_KINDS = ["chief", "member"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];
export const TEAM_ROLE_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type TeamRoleColor = (typeof TEAM_ROLE_COLORS)[number];
export const TEAM_ROLE_ICONS = [
  "user",
  "magnifying-glass",
  "code",
  "pencil",
  "check-circle",
  "palette",
  "chart-bar",
  "bug",
  "compass",
  "shield",
] as const;
export type TeamRoleIcon = (typeof TEAM_ROLE_ICONS)[number];
export type TeamRoleInput = {
  name: string;
  description: string;
  color: TeamRoleColor;
  icon: TeamRoleIcon;
};
export type TeamRole = TeamRoleInput & { id: string };
export type TeamBox = { x: number; y: number; w: number; h: number };
export type TeamPoint = { x: number; y: number };
export type TeamMember = {
  botId: string;
  name: string;
  kind: TeamKind;
  roleId: string | null;
  /** The role's name, empty without a role. */
  role: string;
  canvas: TeamPoint;
};
export type Team = {
  id: string;
  name: string;
  goal: string;
  /** Shared by every room of the team. */
  context: string;
  canvas: TeamBox;
  version: number;
  members: TeamMember[];
};
export type TeamSave = {
  expectedVersion: number;
  name: string;
  goal: string;
  /** Left out: the team's context stays as it is. */
  context?: string;
  canvas: TeamBox;
  members: Omit<TeamMember, "name" | "role">[];
};

export type TeamPerson = { userId: string; name: string; role: "owner" | "member" };
export type TeamCandidate = { userId: string; name: string };

export const teamsApi = {
  roles: () => call<{ roles: TeamRole[] }>("/api/team-roles").then((r) => r.roles),
  createRole: (v: TeamRoleInput) =>
    call<{ role: TeamRole }>("/api/team-roles", "POST", v).then((r) => r.role),
  updateRole: (id: string, v: TeamRoleInput) =>
    call<{ role: TeamRole }>(`/api/team-roles/${id}`, "PUT", v).then((r) => r.role),
  deleteRole: (id: string) => call(`/api/team-roles/${id}`, "DELETE"),
  list: () => call<{ teams: Team[] }>("/api/teams").then((r) => r.teams),
  get: (id: string) => call<{ team: Team }>(`/api/teams/${id}`).then((r) => r.team),
  create: (name: string, canvas: TeamBox) =>
    call<{ team: Team }>("/api/teams", "POST", { name, canvas }).then((r) => r.team),
  save: (id: string, v: TeamSave) =>
    call<{ team: Team }>(`/api/teams/${id}`, "PUT", v).then((r) => r.team),
  archive: (id: string) => call(`/api/teams/${id}`, "DELETE"),
  /** The team's chat: its open room, or a new one. Opening it does not wake the chief. */
  chat: (id: string) =>
    call<{ discussionId: string }>(`/api/teams/${id}/chat`, "POST").then((r) => r.discussionId),
  people: (id: string) =>
    call<{ people: TeamPerson[] }>(`/api/teams/${id}/people`).then((r) => r.people),
  candidates: (id: string) =>
    call<{ candidates: TeamCandidate[] }>(`/api/teams/${id}/candidates`).then((r) => r.candidates),
  addPerson: (id: string, userId: string) =>
    call<{ people: TeamPerson[] }>(`/api/teams/${id}/people`, "POST", { userId }).then(
      (r) => r.people,
    ),
  removePerson: (id: string, userId: string) =>
    call<{ people: TeamPerson[] }>(
      `/api/teams/${id}/people/${encodeURIComponent(userId)}`,
      "DELETE",
    ).then((r) => r.people),
  startRoom: (id: string, v: { title: string; firstMessage?: string; goal?: string }) =>
    call<{ discussionId: string }>(`/api/teams/${id}/rooms`, "POST", v).then((r) => r.discussionId),
};

export const teamsQueries = {
  list: () => queryOptions({ queryKey: ["teams"], queryFn: () => teamsApi.list(), ...STATIC }),
  roles: () =>
    queryOptions({ queryKey: ["teams", "roles"], queryFn: () => teamsApi.roles(), ...STATIC }),
  detail: (id: string) =>
    queryOptions({ queryKey: ["teams", id], queryFn: () => teamsApi.get(id) }),
  people: (id: string) =>
    queryOptions({ queryKey: ["teams", id, "people"], queryFn: () => teamsApi.people(id) }),
  candidates: (id: string) =>
    queryOptions({
      queryKey: ["teams", id, "candidates"],
      queryFn: () => teamsApi.candidates(id),
    }),
};

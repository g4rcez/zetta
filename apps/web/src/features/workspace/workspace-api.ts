import { queryOptions } from "@tanstack/react-query";
import type { InviteRole, WorkspaceRole } from "@zetta/core/workspace";

import type { AvatarValue } from "@/components/bot-avatar";
import { queryClient } from "@/lib/query-client";
import { serverOrigin } from "@/lib/server-origin";
import { call, toApiError } from "../chat/chat-client";

/** The workspace the person is in, and what they are in it (`GET /api/workspace`). */
export type MyWorkspace = {
  workspace: { id: string; slug: string; name: string };
  role: WorkspaceRole;
  isRoot: boolean;
};
/** `kind` is what the bot is to its owner: their own Chief keeps the Zetta picture when it has none of its own. */
export type SharedChief = {
  botId: string;
  name: string;
  avatar: AvatarValue | null;
  kind?: "chief" | "specialist";
};
export type WorkspacePerson = {
  userId: string;
  name: string;
  email: string;
  avatar: unknown;
  title: string;
  role: WorkspaceRole;
  /** The person who set this server up: always an owner. */
  isRoot: boolean;
  isYou: boolean;
  joinedAt: string;
  /** The bot someone shared with this person as their Chief. */
  chief: (SharedChief & { ownerUserId: string }) | null;
};
/** A workspace the person is in (`GET /api/workspace/all`); `current` is the one this tab works in. */
export type WorkspaceEntry = {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  current: boolean;
};
/** What root gets once when it starts a workspace: the code its owner signs up or joins with. */
export type StartedWorkspace = {
  workspace: { id: string; slug: string; name: string };
  invitation: { token: string; expiresAt: string };
};
/** One workspace as root sees it (`GET /api/workspace/operator`): names and numbers, nothing inside it. */
export type OperatedWorkspace = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "deleting";
  createdAt: string;
  people: number;
  /** Root's own workspace: never suspended or deleted. */
  own: boolean;
  usage: { runs: number; runSeconds: number };
  quota: { runsPerMonth: number | null; runSecondsPerMonth: number | null };
};
export type WaitingInvitation = {
  invitationId: string;
  intendedEmail: string;
  createdAt: string;
  expiresAt: string;
  role: InviteRole;
  chief: SharedChief | null;
};

const KEY = ["workspace"] as const;
const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
const person = (userId: string) => `/api/workspace/members/${encodeURIComponent(userId)}`;

export const workspaceApi = {
  mine: () => call<MyWorkspace>("/api/workspace/"),
  members: () => call<{ members: WorkspacePerson[] }>("/api/workspace/members"),
  invitations: () => call<{ invitations: WaitingInvitation[] }>("/api/workspace/invitations"),
  setRole: (userId: string, role: WorkspaceRole) =>
    call(`${person(userId)}/role`, "PUT", { role }).then(refresh),
  shareChief: (userId: string, botId: string) =>
    call(`${person(userId)}/chief`, "PUT", { botId }).then(refresh),
  unshareChief: (userId: string) => call(`${person(userId)}/chief`, "DELETE").then(refresh),
  rename: (name: string) => call("/api/workspace/", "PATCH", { name }).then(refresh),
  all: () => call<{ workspaces: WorkspaceEntry[]; mayCreate: boolean }>("/api/workspace/all"),
  /** Joins another workspace with an invitation made out to this person. */
  join: (token: string) =>
    call<{ workspace: { id: string; slug: string; name: string } }>("/api/workspace/join", "POST", {
      token,
    }).then(async (r) => {
      await refresh();
      return r.workspace;
    }),
  operator: () =>
    call<{ workspaces: OperatedWorkspace[] }>("/api/workspace/operator").then((r) => r.workspaces),
  setQuota: (id: string, quota: OperatedWorkspace["quota"]) =>
    call(`/api/workspace/operator/${id}/quota`, "PUT", quota).then(refresh),
  setStatus: (id: string, status: "active" | "suspended") =>
    call(`/api/workspace/operator/${id}/status`, "PUT", { status }).then(refresh),
  remove: (id: string) => call(`/api/workspace/operator/${id}`, "DELETE").then(refresh),
  /**
   * Downloads a copy of a workspace's data. Fetched, not linked: the call says which workspace this tab works in, as every call does.
   */
  async download(id?: string) {
    const response = await fetch(
      new URL(`/api/workspace/export${id ? `?id=${id}` : ""}`, serverOrigin()),
      { credentials: "include" },
    );
    if (!response.ok) throw await toApiError(response);
    const name =
      /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
      "workspace.ndjson.gz";
    const href = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement("a"), { href, download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
  /** Root starts a workspace for another organization. */
  start: (input: { name: string; slug: string; ownerEmail: string }) =>
    call<StartedWorkspace>("/api/workspace/new", "POST", input).then(async (r) => {
      await refresh();
      return r;
    }),
};

export const workspaceQueries = {
  operator: () =>
    queryOptions({ queryKey: [...KEY, "operator"], queryFn: () => workspaceApi.operator() }),
  all: () => queryOptions({ queryKey: [...KEY, "all"], queryFn: () => workspaceApi.all() }),
  mine: () => queryOptions({ queryKey: [...KEY, "mine"], queryFn: () => workspaceApi.mine() }),
  members: () =>
    queryOptions({
      queryKey: [...KEY, "members"],
      queryFn: () => workspaceApi.members().then((r) => r.members),
    }),
  invitations: () =>
    queryOptions({
      queryKey: [...KEY, "invitations"],
      queryFn: () => workspaceApi.invitations().then((r) => r.invitations),
    }),
};

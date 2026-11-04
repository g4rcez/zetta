import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";

export type DiscussionStatus = "open" | "paused" | "stalled" | "resolved" | "cancelled";
/** `room`: a team or user room. `help` and `permissions`: made by the Chief to solve a bot's issue. */
export type RoomKind = "room" | "help" | "permissions";
export type Discussion = {
  id: string;
  conversationId: string;
  title: string;
  goal: string;
  context: string;
  contextVersion: number;
  status: DiscussionStatus;
  kind: RoomKind;
  tainted: boolean;
  turnsUsed: number;
  summary: string;
  version: number;
  createdByBotId: string | null;
  /** Set for a team room: `createdByBotId` is the team's chief. */
  teamId: string | null;
  originConversationId: string | null;
  originInbound: { plugin: string; chat: string; chatName: string } | null;
  createdAt: string;
  updatedAt: string;
};
export type DiscussionListItem = Discussion & {
  members: { botId: string; name: string }[];
  queued: number;
  running: boolean;
  awaitingApproval: boolean;
};
export type DiscussionMember = {
  botId: string;
  name: string;
  role: string;
  requireApproval: boolean;
  turns: number;
  code: boolean;
};
export type DiscussionTurn = {
  id: string;
  botId: string;
  kind: "reply" | "wrapup";
  status:
    | "queued"
    | "awaiting_approval"
    | "running"
    | "done"
    | "failed"
    | "skipped"
    | "interrupted"
    | "cancelled";
  reasonCode: string | null;
  createdAt: string;
};
export type DiscussionDetail = {
  discussion: Discussion;
  /** Who owns the room. A team member who is not the owner reads the room and cannot change it. */
  owner: { userId: string; name: string };
  members: DiscussionMember[];
  turns: DiscussionTurn[];
  /** Routines made in this room: their work runs in their own chat, not in the room. */
  routines: { id: string; title: string; status: string }[];
};
export type TurnStep = {
  at: string;
  kind: "activity" | "computer" | "tool" | "post" | "report" | "error";
  label: string;
  detail?: string;
};
export type RoomTurn = Pick<DiscussionTurn, "id" | "botId" | "kind" | "status" | "createdAt"> & {
  finishedAt: string | null;
  steps: TurnStep[];
};
export type RoomTaskStatus = "backlog" | "in_progress" | "blocked" | "review" | "done";
export type RoomTask = {
  id: string;
  title: string;
  description: string;
  status: RoomTaskStatus;
  botId: string | null;
};
export type NewDiscussion = {
  title: string;
  goal: string;
  context: string;
  members: { bot: string; role?: string }[];
  firstMessage?: string;
};

export const discussionsApi = {
  list: () =>
    call<{ discussions: DiscussionListItem[] }>("/api/discussions").then((r) => r.discussions),
  running: () => call<{ running: number }>("/api/discussions/running").then((r) => r.running),
  get: (id: string) => call<DiscussionDetail>(`/api/discussions/${id}`),
  seen: (id: string) => call(`/api/discussions/${id}/seen`, "POST", {}),
  startLoop: (id: string, v: { goal: string; doneWhen: string }) =>
    call(`/api/discussions/${id}/loop`, "POST", v),
  steps: (id: string) =>
    call<{ turns: RoomTurn[]; tasks: RoomTask[] }>(`/api/discussions/${id}/steps`),
  create: (v: NewDiscussion) =>
    call<{ discussion: Discussion }>("/api/discussions", "POST", v).then((r) => r.discussion),
  update: (
    id: string,
    expectedVersion: number,
    v: { title?: string; goal?: string; context?: string },
  ) =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}`, "PATCH", {
      expectedVersion,
      ...v,
    }).then((r) => r.discussion),
  /** Moves a room into a team (its chief becomes the facilitator) or out of it (`null`). */
  setTeam: (id: string, teamId: string | null) =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}/team`, "PUT", { teamId }).then(
      (r) => r.discussion,
    ),
  post: (
    id: string,
    content: string,
    files: {
      attachmentIds?: string[];
      fileRefs?: string[];
      wikiIds?: string[];
      skills?: { botId: string; name: string }[];
      /** A message of this room the post replies to. */
      quotedMessageId?: string;
    } = {},
  ) =>
    call(`/api/discussions/${id}/messages`, "POST", {
      content,
      ...(files.attachmentIds?.length ? { attachmentIds: files.attachmentIds } : {}),
      ...(files.fileRefs?.length ? { fileRefs: files.fileRefs } : {}),
      ...(files.wikiIds?.length ? { wikiIds: files.wikiIds } : {}),
      ...(files.skills?.length ? { skills: files.skills } : {}),
      ...(files.quotedMessageId ? { quotedMessageId: files.quotedMessageId } : {}),
    }),
  act: (id: string, action: "pause" | "resume" | "cancel") =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}/${action}`, "POST", {}).then(
      (r) => r.discussion,
    ),
  silence: (id: string) =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}/silence`, "POST", {}).then(
      (r) => r.discussion,
    ),
  stopGoals: (id: string) =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}/stop-goals`, "POST", {}).then(
      (r) => r.discussion,
    ),
  remove: (id: string) =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}/delete`, "POST", {}).then(
      (r) => r.discussion,
    ),
  resolve: (id: string, summary: string) =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}/resolve`, "POST", { summary }).then(
      (r) => r.discussion,
    ),
  setApproval: (id: string, botId: string, requireApproval: boolean) =>
    call(`/api/discussions/${id}/members/${botId}`, "PUT", { requireApproval }),
  peers: (botId: string) =>
    call<{ peers: { id: string; name: string }[] }>(`/api/bots/${botId}/peers`).then(
      (r) => r.peers,
    ),
  setPeers: (botId: string, peerBotIds: string[]) =>
    call<{ peers: { id: string; name: string }[] }>(`/api/bots/${botId}/peers`, "PUT", {
      peerBotIds,
    }).then((r) => r.peers),
};

export const STATUS_LABEL: Record<DiscussionStatus, string> = {
  open: "Working",
  paused: "Paused",
  stalled: "Needs you",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

/** Reads as cache entries: `["discussions"]` is the prefix of every room read, so one invalidation refreshes list and detail. */
export const discussionsQueries = {
  list: () =>
    queryOptions({ queryKey: ["discussions", "list"], queryFn: () => discussionsApi.list() }),
  running: () =>
    queryOptions({ queryKey: ["discussions", "running"], queryFn: () => discussionsApi.running() }),
  detail: (id: string) =>
    queryOptions({ queryKey: ["discussions", id], queryFn: () => discussionsApi.get(id) }),
  steps: (id: string) =>
    queryOptions({
      queryKey: ["discussions", id, "steps"],
      queryFn: () => discussionsApi.steps(id),
    }),
};

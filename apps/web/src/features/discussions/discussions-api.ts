import { call } from "../chat/chat-client";

export type DiscussionStatus = "open" | "paused" | "stalled" | "resolved" | "cancelled";
export type Discussion = {
  id: string;
  conversationId: string;
  title: string;
  goal: string;
  context: string;
  contextVersion: number;
  status: DiscussionStatus;
  tainted: boolean;
  turnBudget: number;
  turnsUsed: number;
  summary: string;
  version: number;
  createdByBotId: string | null;
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
  members: DiscussionMember[];
  turns: DiscussionTurn[];
};
export type NewDiscussion = {
  title: string;
  goal: string;
  context: string;
  members: { bot: string; role?: string }[];
  firstMessage: string;
  turnBudget?: number;
};

export const discussionsApi = {
  list: () =>
    call<{ discussions: DiscussionListItem[] }>("/api/discussions").then((r) => r.discussions),
  get: (id: string) => call<DiscussionDetail>(`/api/discussions/${id}`),
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
  post: (
    id: string,
    content: string,
    files: { attachmentIds?: string[]; fileRefs?: string[] } = {},
  ) =>
    call(`/api/discussions/${id}/messages`, "POST", {
      content,
      ...(files.attachmentIds?.length ? { attachmentIds: files.attachmentIds } : {}),
      ...(files.fileRefs?.length ? { fileRefs: files.fileRefs } : {}),
    }),
  act: (id: string, action: "pause" | "resume" | "cancel") =>
    call<{ discussion: Discussion }>(`/api/discussions/${id}/${action}`, "POST", {}).then(
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

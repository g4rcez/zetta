import { uuidv7 } from "@zetta/core/uuid";
import { ENV } from "../../env";
import { createSealedSend, type PublishedTransportKey } from "./sealed-send";

export type BotAvatarValue =
  | { kind: "preset"; preset: string; colors: string[] }
  | { kind: "image"; src: string };
export type Bot = {
  avatar?: BotAvatarValue | null;
  id: string;
  kind: "chief" | "specialist";
  name: string;
  /** Friendly-url id, unique and fixed at creation; names the bot's database. */ slug?: string;
  description: string;
  visibility: "private" | "team";
  canEdit: boolean;
  version: number;
  workspaceId?: string | null;
  onboarded: boolean;
  harness: string;
  model: string | null;
  personality: string;
  instructions: string;
  /** Tone of voice. Missing on the public card of a bot you do not own. */
  outputStyle?: OutputStyleKey;
  outputStyleId?: string | null;
  computerMode?: ComputerMode;
  codeAccess?: boolean;
  commitIdentity?: CommitIdentity;
  commitEmail?: string | null;
  requiredConnections?: RequiredConnection[];
};
/** A built-in key, or `custom` together with `outputStyleId`. A patch sends both or neither. */
export type OutputStyleKey =
  | "default"
  | "proactive"
  | "concise"
  | "explanatory"
  | "learning"
  | "custom";
/** Who a code bot's commits are signed as: the server's git config, the bot's own address, the owner's account, or `commitEmail`. */
export type CommitIdentity = "git-config" | "bot" | "account" | "custom";
export type ComputerMode = "off" | "browser" | "desktop";
export type BotStatus = "available" | "working" | "planning" | "pending" | "error" | "offline";
export type BotStatusEntry = { botId: string; status: BotStatus; reason: string };
export type Provider = "anthropic" | "openai" | "google" | "openrouter" | "github";
export const PROVIDERS: readonly Provider[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "github",
];
export type RequiredConnection = { key: string; provider: Provider };
export type BotPatch = Partial<{
  avatar: BotAvatarValue | null;
  name: string;
  description: string;
  harness: string;
  model: string | null;
  personality: string;
  instructions: string;
  outputStyle: OutputStyleKey;
  outputStyleId: string | null;
  computerMode: ComputerMode;
  codeAccess: boolean;
  commitIdentity: CommitIdentity;
  commitEmail: string | null;
  requiredConnections: RequiredConnection[];
}>;
export type Conversation = {
  id: string;
  botId: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  favorite?: boolean;
  archived?: boolean;
  kind?: "chat" | "discussion" | "inbound";
};
export type Workspace = { id: string; name: string; parentId?: string | null };
export type ProposalKind =
  | "config"
  | "create_bot"
  | "create_routine"
  | "create_workflow"
  | "create_vm"
  | "open_discussion"
  | "discussion_brief"
  | "start_loop"
  | "team_goals"
  | "bot_permission"
  | "create_wiki_page";
export type Proposal = {
  id: string;
  botId: string | null;
  kind?: ProposalKind;
  diff: { field: string; from: unknown; to: unknown }[];
  patch?: Record<string, unknown>;
};
export type DecisionResult = { status: "approved" | "rejected" | "stale" };
export type Hook = {
  id: string;
  kind: "add_context" | "redact" | "stop" | "background";
  pattern: string;
  value: string;
  enabled?: boolean;
  position?: number;
};
export type HookDryRun = {
  text: string;
  stopped: boolean;
  stopMessage?: string | null;
  addedContext: string[];
  backgroundTasks: number;
  skippedInvalid: number;
};
export type Attachment = { id: string; name: string; size: number; mimeType?: string };
export const isImage = (a: { mimeType?: string | undefined }) => !!a.mimeType?.startsWith("image/");
export type Reaction = { emoji: string; count: number; mine: boolean };
export type Receipt = {
  kind:
    | "memory"
    | "instruction"
    | "proposal"
    | "computer"
    | "agenda"
    | "task"
    | "discussion"
    | "artifact"
    | "wiki"
    | "bot"
    | "team";
  id: string;
  text: string;
  created?: boolean;
  avatar?: BotAvatarValue | null;
};
/** The checklist a bot announced with zetta:plan; each update carries the whole list. */
export type PlanStep = { id: string; title: string; status: "pending" | "active" | "done" };
export type MessageMeta = {
  used?: {
    memories?: string[];
    instructions?: string[];
    wiki?: string[];
    /** Company documents the bot was shown, in citation order. */ docs?: {
      docId: string;
      chunkId: string;
    }[];
  };
  receipts?: Receipt[];
  plan?: PlanStep[];
  /** A message sent while a bot worked, read by that bot at its next step (`replyId` is the reply that used it) instead of getting its own answer. */
  steer?: { replyId: string; at: number };
  /** What the bot did while it worked, oldest first (`at` is epoch ms). */ timeline?: {
    at: number;
    label: string;
  }[];
  decision?: { action: string; choice?: string; confidence?: number };
  /** GitHub repositories (`owner/repo`) this code run worked in, most recent first: where `#12` and commit ids of the reply point. */
  repos?: string[];
  /** Written by outside people through a channel plugin (WhatsApp, Telegram...). */ inbound?: {
    plugin: string;
    label: string;
    chat: string;
    chatName: string;
  };
  /** A group discussion this chat started reported back. */ discussion?: {
    id: string;
    title: string;
    status: string;
  };
} | null;
export type Message = {
  attachments?: Attachment[];
  botId?: string | null;
  parentMessageId?: string | null;
  id: string;
  seq: number;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "failed" | "running" | "interrupted" | "cancelled";
  reactions?: Reaction[];
  meta?: MessageMeta;
  createdAt?: string;
  replyCount?: number;
  /** Sent while the chat was busy: waits for its answer (in its thread), is being answered, or could not be answered. */
  queue?: "pending" | "running" | "failed";
};
export type UsedKnowledge = {
  memories: { id: string; content: string }[];
  wiki: { id: string; slug: string; title: string }[];
};
export type ConnectionState = "active" | "revoked" | string;
export type Connection = {
  id: string;
  provider: Provider;
  label: string;
  state: ConnectionState;
  revision: number;
};
export type ConnectionList = {
  configured: boolean;
  providers: Provider[];
  connections: Connection[];
};
export type Requirement = {
  key: string;
  provider: Provider;
  status: "ready" | "missing" | "unusable";
};
export type DecisionOption = {
  label: string;
  description: string;
  action: "respond" | "ask_user" | "delegate" | "stop";
  targetBotId?: string;
  reply?: string;
};
export type DecisionConfig = {
  backend?: "laya" | "jev";
  enabled: boolean;
  question: string;
  options: DecisionOption[];
  minConfidencePct: number;
};
export type Route = {
  action: "respond" | "ask_user" | "delegate" | "stop";
  reason?: string;
  choice?: string;
  confidence?: number;
  reply?: string;
  targetBotId?: string;
};
export type PreviewPart = {
  seq: number;
  role: string;
  author?: string;
  content: string;
  thread?: number;
  attachments?: string[];
  reactions?: Record<string, number>;
};
export type SnapshotPreview = {
  title: string;
  botName: string;
  parts: PreviewPart[];
  previewHash: string;
};
export type AttentionSummary = { open: number; unread: number; acknowledged: number };

/** An error from the server. `message` is already plain-language; `code` is the stable machine code. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
const fallbackMessage = (status: number) =>
  status === 401
    ? "Your session ended. Sign in again."
    : status === 404
      ? "That is no longer available."
      : status === 403
        ? "You do not have access to that."
        : "Something went wrong. Please retry.";
export async function toApiError(response: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string } & Record<string, unknown> } | undefined;
  try {
    body = await response.json();
  } catch {
    /* not JSON */
  }
  const { code, message, ...details } = body?.error ?? {};
  return new ApiError(
    response.status === 401
      ? fallbackMessage(401)
      : typeof message === "string" && message
        ? message
        : fallbackMessage(response.status),
    response.status,
    typeof code === "string" ? code : "UNKNOWN",
    details,
  );
}
export const errorMessage = (e: unknown, fallback = "Something went wrong. Please retry.") =>
  e instanceof Error && e.message ? e.message : fallback;
export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : undefined);

/** A read that never answers must surface as an error instead of an endless spinner (writes can legitimately run long). */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Identical GETs in flight share one request (several components load the same list on mount). Each caller reads its own clone.
 * Any write clears the map, so a read that starts after a write never joins a request that began before it.
 */
const inflight = new Map<string, Promise<Response>>();
export async function call<T>(path: string, method = "GET", body?: object): Promise<T> {
  const request = () =>
    fetch(new URL(path, ENV.VITE_SERVER_URL), {
      method,
      credentials: "include",
      cache: "no-store",
      ...(method === "GET" ? { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } : {}),
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  let response: Response;
  if (method === "GET" && !body) {
    let pending = inflight.get(path);
    if (!pending) {
      const started = (pending = request());
      inflight.set(path, started);
      const done = () => {
        if (inflight.get(path) === started) inflight.delete(path);
      };
      started.then(done, done);
    }
    response = (await pending).clone();
  } else {
    inflight.clear();
    try {
      response = await request();
    } finally {
      inflight.clear();
    }
  }
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}

/** Sends a credential sealed to the server's transport key (see ./sealed-send): the raw secret never appears in a request body. */
export const sendSealed = createSealedSend(() =>
  call<PublishedTransportKey>("/api/connections/transport-key"),
);

export type InterviewInput = {
  harness: string;
  model?: string | null;
  name: string;
  description?: string;
  transcript: { question: string; answer: string }[];
  /** The style picked so far, so the engine keeps it or a custom one. */
  outputStyle?: OutputStyleKey;
  refine?: { personality: string; instructions: string; change: string };
};
export type InterviewResult =
  | { kind: "question"; question: string; suggestions: string[] }
  | {
      kind: "draft";
      personality: string;
      instructions: string;
      summary: string[];
      /** The built-in style the engine recommends; absent when it chose none. */
      outputStyle?: Exclude<OutputStyleKey, "custom">;
    }
  | { kind: "unavailable"; reason: string };

export const chatClient = {
  bots: () => call<{ bots: Bot[] }>("/api/bots").then((r) => r.bots),
  botStatuses: () =>
    call<{ statuses: BotStatusEntry[] }>("/api/bots/status").then((r) => r.statuses),
  createBot: (input: {
    avatar?: BotAvatarValue | null;
    name: string;
    description?: string;
    visibility?: "private" | "team";
    harness?: string;
    model?: string | null;
    personality?: string;
    instructions?: string;
    outputStyle?: OutputStyleKey;
    outputStyleId?: string | null;
  }) => call<{ bot: Bot }>("/api/bots", "POST", input).then((r) => r.bot),
  interviewBot: (input: InterviewInput) =>
    call<InterviewResult>("/api/bots/interview", "POST", input),
  updateBot: (id: string, expectedVersion: number, patch: BotPatch) =>
    call<{ bot: Bot }>(`/api/bots/${id}`, "PATCH", { expectedVersion, patch }).then((r) => r.bot),
  deleteBot: (id: string) => call<{ bot: Bot }>(`/api/bots/${id}`, "DELETE").then((r) => r.bot),
  conversations: (botId?: string, archived = false) =>
    call<{ conversations: Conversation[] }>(
      `/api/conversations?${new URLSearchParams({ ...(botId ? { botId } : {}), ...(archived ? { archived: "true" } : {}) })}`,
    ).then((r) => r.conversations),
  /** One chat by id, also a routine's chat that `conversations()` leaves out. */
  conversation: (id: string) =>
    call<{ conversation: Conversation }>(`/api/conversations/${id}`).then((r) => r.conversation),
  deleteConversation: (id: string) => call(`/api/conversations/${id}`, "DELETE"),
  startConversation: (botId: string) =>
    call<{ conversation: Conversation }>("/api/conversations", "POST", { botId }).then(
      (r) => r.conversation,
    ),
  updateConversation: (
    id: string,
    patch: { title?: string; pinned?: boolean; favorite?: boolean; archived?: boolean },
  ) =>
    call<{ conversation: Conversation }>(`/api/conversations/${id}`, "PATCH", patch).then(
      (r) => r.conversation,
    ),
  messages: (id: string) =>
    call<{ messages: Message[] }>(`/api/conversations/${id}/messages`).then((r) => r.messages),
  /** Saves a message while the chat is busy; the server answers it in its thread when the turns before it end. */
  enqueue: (
    id: string,
    body: {
      clientRequestId: string;
      content: string;
      parentMessageId?: string;
      attachmentIds?: string[];
      fileRefs?: string[];
      wikiIds?: string[];
    },
  ) =>
    call<{ message: Message }>(`/api/conversations/${id}/queue`, "POST", body).then(
      (r) => r.message,
    ),
  removeQueued: (id: string, messageId: string) =>
    call(`/api/conversations/${id}/queue/${messageId}`, "DELETE"),
  retryQueued: (id: string, messageId: string) =>
    call(`/api/conversations/${id}/queue/${messageId}/retry`, "POST"),
  workspaces: () => call<{ workspaces: Workspace[] }>("/api/workspaces").then((r) => r.workspaces),
  createWorkspace: (name: string, parentId?: string) =>
    call<{ workspace: Workspace }>("/api/workspaces", "POST", {
      name,
      ...(parentId ? { parentId } : {}),
    }).then((r) => r.workspace),
  proposals: () => call<{ proposals: Proposal[] }>("/api/proposals").then((r) => r.proposals),
  decide: (id: string, approve: boolean) =>
    call<DecisionResult>(`/api/proposals/${id}/decision`, "POST", { approve }),
  moveBot: (id: string, workspaceId: string | null) =>
    call<{ bot: Bot }>(`/api/bots/${id}/workspace`, "POST", { workspaceId }).then((r) => r.bot),
  hooks: (id: string) => call<{ hooks: Hook[] }>(`/api/bots/${id}/hooks`).then((r) => r.hooks),
  addHook: (id: string, hook: { kind: Hook["kind"]; pattern?: string; value?: string }) =>
    call<{ hook: Hook }>(`/api/bots/${id}/hooks`, "POST", hook).then((r) => r.hook),
  updateHook: (
    id: string,
    patch: { enabled?: boolean; position?: number; pattern?: string; value?: string },
  ) => call<{ hook: Hook }>(`/api/hooks/${id}`, "PATCH", patch).then((r) => r.hook),
  deleteHook: (id: string) => call(`/api/hooks/${id}`, "DELETE"),
  dryRunHooks: (botId: string, text: string) =>
    call<{ result: HookDryRun }>(`/api/bots/${botId}/hooks/dry-run`, "POST", { text }).then(
      (r) => r.result,
    ),
  previewSnapshot: (conversationId: string) =>
    call<{ preview: SnapshotPreview }>("/api/snapshots/preview", "POST", { conversationId }).then(
      (r) => r.preview,
    ),
  publishSnapshot: (conversationId: string, previewHash: string) =>
    call("/api/snapshots", "POST", {
      conversationId,
      previewHash,
      requestKey: uuidv7(),
    }),
  react: (messageId: string, emoji: string) =>
    call(`/api/messages/${messageId}/reactions`, "POST", { emoji }),
  unreact: (messageId: string, emoji: string) =>
    call(`/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, "DELETE"),
  sources: (messageId: string) =>
    call<{
      sources: { n: number; docId: string; name: string; link: string | null; snippet: string }[];
    }>(`/api/messages/${messageId}/sources`).then((r) => r.sources),
  usedKnowledge: (messageId: string) => call<UsedKnowledge>(`/api/messages/${messageId}/knowledge`),
  /** Saves text as a wiki procedure (tag instruction) the bots find when a similar task comes up. */
  saveToWiki: (title: string, content: string) =>
    call(`/api/wiki/${encodeURIComponent(title.slice(0, 80))}`, "PUT", {
      title,
      content,
      tags: ["instruction"],
      expectedVersion: 0,
    }),
  connections: () => call<ConnectionList>("/api/connections"),
  requirements: (botId: string) =>
    call<{ requirements: Requirement[] }>(`/api/bots/${botId}/connections`).then(
      (r) => r.requirements,
    ),
  bindConnection: (botId: string, key: string, connectionId: string) =>
    call(`/api/bots/${botId}/connections/${encodeURIComponent(key)}`, "PUT", { connectionId }),
  decisionConfig: (botId: string) =>
    call<{ decision: DecisionConfig | null }>(`/api/bots/${botId}/decision`).then(
      (r) => r.decision,
    ),
  saveDecisionConfig: (botId: string, config: DecisionConfig) =>
    call<{ decision: DecisionConfig }>(`/api/bots/${botId}/decision`, "PUT", config).then(
      (r) => r.decision,
    ),
  previewDecision: (botId: string, text: string) =>
    call<{ route: Route }>(`/api/bots/${botId}/decision/preview`, "POST", { text }).then(
      (r) => r.route,
    ),
  attentionSummary: () =>
    call<{ summary: AttentionSummary }>("/api/attention/summary").then((r) => r.summary),
};

export const cancelTurn = (conversationId: string) =>
  call(`/api/conversations/${conversationId}/cancel`, "POST");
/** A goal a bot keeps working on across turns after the user approved it (server: modules/chat/loops.ts). */
export type GoalLoop = {
  id: string;
  conversationId: string;
  botId: string;
  goal: string;
  doneWhen: string;
  status: "running" | "paused" | "done" | "failed" | "cancelled";
  iterations: number;
  progress: string;
  reason: string | null;
  /** While in the future, the loop waits before its next try (a failed step is retried with backoff). */
  retryAt: string | null;
  updatedAt: string;
};
export const loopsOf = (conversationId: string) =>
  call<{ loops: GoalLoop[] }>(`/api/conversations/${conversationId}/loops`).then((r) => r.loops);
export const setLoop = (id: string, to: "stop" | "resume") =>
  call<{ loop: GoalLoop }>(`/api/loops/${id}/${to}`, "POST").then((r) => r.loop);
export const uploadAttachment = (name: string, text: string, conversationId?: string) =>
  call<{ attachment: Attachment }>("/api/attachments", "POST", {
    name,
    mimeType: "text/plain",
    text,
    ...(conversationId ? { conversationId } : {}),
  }).then((r) => r.attachment);
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const toBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
export const uploadImage = async (file: File, conversationId?: string) =>
  call<{ attachment: Attachment }>("/api/attachments", "POST", {
    name: file.name || "image.png",
    mimeType: file.type,
    dataBase64: await toBase64(file),
    ...(conversationId ? { conversationId } : {}),
  }).then((r) => r.attachment);
export const listFiles = (path: string) =>
  call<{ entries: { name: string; kind: "file" | "dir" }[] }>(
    `/api/files?path=${encodeURIComponent(path)}`,
  ).then((r) => r.entries);

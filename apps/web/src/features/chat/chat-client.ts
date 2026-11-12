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
  folderId?: string | null;
  onboarded: boolean;
  harness: string;
  model: string | null;
  /** Harness a turn moves to when the main one hits its limit or cannot sign in. Missing on the public card of a bot you do not own. */
  fallbackHarness?: string | null;
  fallbackModel?: string | null;
  personality: string;
  instructions: string;
  /** Tone of voice. Missing on the public card of a bot you do not own. */
  outputStyle?: OutputStyleKey;
  outputStyleId?: string | null;
  computerMode?: ComputerMode;
  autoLearn?: AutoLearn;
  codeAccess?: boolean;
  commitIdentity?: CommitIdentity;
  commitEmail?: string | null;
  requiredConnections?: RequiredConnection[];
  /** Set when the bot was imported from outside. Only the owner's own list carries it. */
  origin?: BotOrigin | null;
};
/** Where an imported bot came from, and the outside apps it was built to use (matched to a Zetta plugin when one exists). */
export type BotOrigin = {
  source: "grok_marketplace";
  url: string;
  slug: string;
  creator: string;
  handle: string | null;
  importedAt: string;
  integrations: { name: string; description: string; pluginId: string | null }[];
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
export type Provider = "anthropic" | "openai" | "google" | "openrouter" | "deepseek" | "github";
export const PROVIDERS: readonly Provider[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "deepseek",
  "github",
];
export type RequiredConnection = { key: string; provider: Provider };
export type BotPatch = Partial<{
  avatar: BotAvatarValue | null;
  name: string;
  description: string;
  harness: string;
  model: string | null;
  fallbackHarness: string | null;
  fallbackModel: string | null;
  personality: string;
  instructions: string;
  outputStyle: OutputStyleKey;
  outputStyleId: string | null;
  computerMode: ComputerMode;
  autoLearn?: AutoLearn;
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
export type Folder = { id: string; name: string; parentId?: string | null };
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
  | "create_memory_item"
  | "install_skills"
  /** A change to the user's setup that the chief asked for (routines, teams, bots, styles...). `patch.title` says what. */
  | "chief_action"
  /** Changes a bot asked for after it read outside content (task moves, Agenda, team setup); `diff` lists them. */
  | "bot_action"
  /** A tool call that stopped for the person (an approval or a form); `patch.pause` says what. See tool-card.tsx. */
  | "tool_resume"
  /** A bot-made app whose backend would run on the server host: nothing has run until the person approves. See app-author.ts. */
  | "publish_app";
/** Autolearn: the bot saves what it learned as its own skill (auto), asks first (suggest), or not at all (off). */
export type AutoLearn = "off" | "suggest" | "auto";
export type ApprovalRule = {
  id: string;
  /** Set for "Allow in this chat": the rule holds only there. */
  conversationId?: string | null;
  kind: string;
  actionKey: string;
  label: string;
  createdAt: string;
};
/** Cards that can be answered with "Always allow for this bot" (the server keeps the same list in chat/approval-rules.ts). */
export const REMEMBERABLE: readonly ProposalKind[] = [
  "config",
  "create_bot",
  "create_routine",
  "create_workflow",
  "open_discussion",
  "start_loop",
  "team_goals",
  "create_memory_item",
  "chief_action",
  "bot_action",
];
export type Proposal = {
  id: string;
  /** The bot the change is about. */
  botId: string | null;
  /** The bot that asked; the card shows it. Absent on old rows: then the card is the target bot's. */
  proposedByBotId?: string | null;
  kind?: ProposalKind;
  diff: { field: string; from: unknown; to: unknown }[];
  patch?: Record<string, unknown>;
  /** When nobody has decided by then, the server closes the card. */
  expiresAt?: string;
  /** `hold`: the card widens what a bot may do, so Approve is a press-and-hold. Absent on old servers: a click. */
  confirm?: "hold" | "click";
};
export type DecisionResult = {
  status: "approved" | "rejected" | "stale";
  /** A line for the person when the change worked only in part (for example a routine that stays paused). */
  note?: string;
  /** Only for a proposal to save a memory item: the item it saved, so the page can link to it. */
  memory?: { slug: string; title: string; created: boolean };
  /** Only for a proposal to install skills: what was installed and where. */
  skills?: {
    installed: string[];
    /** Skills that were already installed and were given to more bots. */
    attached: string[];
    failed: { path: string; code: string }[];
    attachError: string | null;
    bots: number;
    skippedBots: number;
  };
};
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
    /** Notes saved in older answers. */
    | "note"
    | "proposal"
    | "computer"
    | "agenda"
    | "task"
    | "discussion"
    | "artifact"
    | "playground"
    | "app"
    | "memory"
    | "bot"
    | "team"
    | "skill";
  id: string;
  text: string;
  created?: boolean;
  avatar?: BotAvatarValue | null;
  /** A task the chief handed to a member of a team room: who has it and how it is done. */
  assignee?: { botId: string; name: string };
  doneWhen?: string;
  /** Memory receipts: the version this write made (Undo restores the one before, or archives a new item). */
  version?: number;
  /** Skill receipts from autolearn: the bot created or revised one of its own skills, or suggests one (`id` is then the review). */
  learn?: "created" | "revised" | "suggested";
};
/** The checklist a bot announced with zetta:plan; each update carries the whole list. */
export type PlanStep = { id: string; title: string; status: "pending" | "active" | "done" };
/** A poll, kept on its message: what is asked, how many options a voter may pick, and whether it still takes votes. */
export type PollView = {
  question: string;
  mode: "single" | "multiple";
  status: "open" | "closed";
  options: { id: string; label: string }[];
  closedAt?: string;
};
/** What each option has so far: how many picked it, whether the viewer did, and which bots did. */
export type PollVotes = Record<string, { count: number; mine: boolean; botIds: string[] }>;

export type MessageMeta = {
  poll?: PollView;
  used?: {
    notes?: string[];
    instructions?: string[];
    items?: string[];
    /** Company documents the bot was shown, in citation order. */ docs?: {
      docId: string;
      chunkId: string;
    }[];
  };
  receipts?: Receipt[];
  plan?: PlanStep[];
  /** A message sent while a bot worked, read by that bot at its next step (`replyId` is the reply that used it) instead of getting its own answer. */
  steer?: { replyId: string; at: number };
  /** The person typed "stop" while work was going on: what the stop did. */
  stop?: { held: number; rooms: number };
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
  /** The message this one replies to in the channel (a snapshot, not a thread). */ quote?: {
    id: string;
    role: "user" | "assistant";
    botId: string | null;
    excerpt: string;
  };
  /** A group discussion this chat started reported back. */ discussion?: {
    id: string;
    title: string;
    status: string;
  };
} | null;
/** A message pinned to the top of its conversation: who wrote it, its first words, and who pinned it and when. */
export type Pin = {
  messageId: string;
  role: "user" | "assistant";
  botId: string | null;
  excerpt: string;
  pinnedByUserId: string;
  pinnedAt: string;
};

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
  /** On a person's message: the bots that have picked it up (see the server's `seen.ts`). Empty until one has. */
  seenBy?: string[];
  /** On a poll: the votes so far. */
  pollVotes?: PollVotes;
  /**
   * Sent while the chat was busy. `pending`: waits. `running`: being answered. `merged`: being answered together with the messages
   * sent after it. `held`: the person stopped the bot before it was read; it is sent or removed by hand. `failed`: not answered.
   */
  queue?: "pending" | "running" | "failed" | "merged" | "held";
};
export type UsedKnowledge = {
  notes: { id: string; content: string }[];
  items: { id: string; slug: string; title: string }[];
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
/** Reads that several components share go through the query cache (`lib/query-client.ts`), which sends one request per key. */
export async function call<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(new URL(path, ENV.VITE_SERVER_URL), {
    method,
    credentials: "include",
    // The server marks most answers `no-store`, so those are never kept. The polled lists carry an ETag: the browser asks
    // `If-None-Match` and the server answers 304 when nothing changed.
    cache: "no-cache",
    ...(method === "GET" ? { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } : {}),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

/** Server-sent events with what a command of the running turn prints (see apps/server/src/modules/chat/step-output.ts). */
export const stepOutputUrl = (conversationId: string, stepId: string) =>
  new URL(
    `/api/conversations/${conversationId}/steps/${encodeURIComponent(stepId)}/output`,
    ENV.VITE_SERVER_URL,
  ).toString();

export const chatClient = {
  bots: () => call<{ bots: Bot[] }>("/api/bots").then((r) => r.bots),
  /** What the person can pick for this bot with `/`: names and descriptions, no instructions. */
  botSkills: (id: string) =>
    call<{ skills: { name: string; description: string }[] }>(`/api/bots/${id}/skills`).then(
      (r) => r.skills,
    ),
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
    computerMode?: "off" | "browser" | "desktop";
    codeAccess?: boolean;
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
  /** Saves a message while the chat is busy; the server answers it, with whatever else waits, when the turn before it ends. */
  enqueue: (
    id: string,
    body: {
      clientRequestId: string;
      content: string;
      parentMessageId?: string;
      quotedMessageId?: string;
      poll?: { options: string[]; mode: "single" | "multiple" };
      attachmentIds?: string[];
      fileRefs?: string[];
      memoryIds?: string[];
      skills?: string[];
    },
  ) =>
    call<{ message: Message }>(`/api/conversations/${id}/queue`, "POST", body).then(
      (r) => r.message,
    ),
  /** Ends the running reply so the waiting messages are read now; the next turn continues the work (not a Stop). */
  interrupt: (id: string) =>
    call<{ interrupted: boolean }>(`/api/conversations/${id}/interrupt`, "POST"),
  removeQueued: (id: string, messageId: string) =>
    call(`/api/conversations/${id}/queue/${messageId}`, "DELETE"),
  retryQueued: (id: string, messageId: string) =>
    call(`/api/conversations/${id}/queue/${messageId}/retry`, "POST"),
  folders: () => call<{ folders: Folder[] }>("/api/folders").then((r) => r.folders),
  createFolder: (name: string, parentId?: string) =>
    call<{ folder: Folder }>("/api/folders", "POST", {
      name,
      ...(parentId ? { parentId } : {}),
    }).then((r) => r.folder),
  /** With `botId`, only what that bot asked: a chat shows the proposals of its own bot. */
  proposals: (botId?: string) =>
    call<{ proposals: Proposal[] }>(
      botId ? `/api/proposals?botId=${encodeURIComponent(botId)}` : "/api/proposals",
    ).then((r) => r.proposals),
  decide: (
    id: string,
    approve: boolean,
    selection?: { paths: string[]; target: "bot" | "all" | "picked" },
    answer?: Record<string, string | number | boolean>,
    /** "bot": also allow this kind of change by this bot from now on; "chat": only in `conversationId`. */
    remember?: "none" | "bot" | "chat",
    conversationId?: string,
  ) =>
    call<DecisionResult>(`/api/proposals/${id}/decision`, "POST", {
      approve,
      ...(selection ? { selection } : {}),
      ...(answer ? { answer } : {}),
      ...(remember === "bot" || remember === "chat" ? { remember } : {}),
      ...(remember === "chat" && conversationId ? { conversationId } : {}),
    }),
  /** "Always allow" rules the person saved for a bot. */
  approvalRules: (botId: string) =>
    call<{ rules: ApprovalRule[] }>(`/api/bots/${botId}/approval-rules`).then((r) => r.rules),
  revokeApprovalRule: (id: string) => call(`/api/approval-rules/${id}`, "DELETE"),
  moveBot: (id: string, folderId: string | null) =>
    call<{ bot: Bot }>(`/api/bots/${id}/folder`, "POST", { folderId }).then((r) => r.bot),
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
  /** Sets the viewer's whole choice on a poll (the option ids; empty takes the vote back). */
  votePoll: (conversationId: string, messageId: string, options: string[]) =>
    call(`/api/conversations/${conversationId}/messages/${messageId}/poll/vote`, "PUT", {
      options,
    }),
  closePoll: (conversationId: string, messageId: string) =>
    call(`/api/conversations/${conversationId}/messages/${messageId}/poll/close`, "POST", {}),
  /** The pinned messages of a conversation (a chat or a room), newest first. */
  pins: (conversationId: string) =>
    call<{ pins: Pin[] }>(`/api/conversations/${conversationId}/pins`).then((r) => r.pins),
  pin: (conversationId: string, messageId: string) =>
    call<{ pins: Pin[] }>(`/api/conversations/${conversationId}/pins`, "POST", {
      messageId,
    }).then((r) => r.pins),
  unpin: (conversationId: string, messageId: string) =>
    call<{ pins: Pin[] }>(`/api/conversations/${conversationId}/pins/${messageId}`, "DELETE").then(
      (r) => r.pins,
    ),
  react: (messageId: string, emoji: string) =>
    call(`/api/messages/${messageId}/reactions`, "POST", { emoji }),
  unreact: (messageId: string, emoji: string) =>
    call(`/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, "DELETE"),
  sources: (messageId: string) =>
    call<{
      sources: { n: number; docId: string; name: string; link: string | null; snippet: string }[];
    }>(`/api/messages/${messageId}/sources`).then((r) => r.sources),
  usedKnowledge: (messageId: string) => call<UsedKnowledge>(`/api/messages/${messageId}/knowledge`),
  /** Saves text as a memory procedure (tag instruction) the bots find when a similar task comes up. */
  saveToMemory: (title: string, content: string) =>
    call<{ slug: string }>(`/api/memory/${encodeURIComponent(title.slice(0, 80))}`, "PUT", {
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

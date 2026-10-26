import { ENV } from "../../env";

export type Bot = { id: string; kind: "chief" | "specialist"; name: string; description: string; visibility: "private" | "team"; canEdit: boolean; version: number; workspaceId?: string | null; onboarded: boolean; harness: string; model: string | null; personality: string; instructions: string; requiredConnections?: RequiredConnection[] };
export type Provider = "anthropic" | "openai" | "google" | "openrouter";
export const PROVIDERS: readonly Provider[] = ["anthropic", "openai", "google", "openrouter"];
export type RequiredConnection = { key: string; provider: Provider };
export type BotPatch = Partial<{ name: string; description: string; harness: string; model: string | null; personality: string; instructions: string; requiredConnections: RequiredConnection[] }>;
export type Conversation = { id: string; botId: string; title: string; updatedAt: string };
export type Workspace = { id: string; name: string; parentId?: string | null };
export type ProposalKind = "config" | "create_bot" | "create_routine" | "create_workflow" | "create_instruction";
export type Proposal = { id: string; botId: string | null; kind?: ProposalKind; diff: { field: string; from: unknown; to: unknown }[] };
export type DecisionResult = { status: "approved" | "rejected" | "stale" };
export type Hook = { id: string; kind: "add_context" | "redact" | "stop" | "background"; pattern: string; value: string; enabled?: boolean; position?: number };
export type HookDryRun = { text: string; stopped: boolean; stopMessage?: string | null; addedContext: string[]; backgroundTasks: number; skippedInvalid: number };
export type Attachment = { id: string; name: string; size: number };
export type Reaction = { emoji: string; count: number; mine: boolean };
export const REACTION_EMOJIS = ["👍", "👎", "❤️", "🎉", "👀", "✅"] as const;
export type Receipt = { kind: "memory" | "instruction" | "proposal"; id: string; text: string; created?: boolean };
export type MessageMeta = { used?: { memories?: string[]; instructions?: string[] }; receipts?: Receipt[]; decision?: { action: string; choice?: string; confidence?: number } } | null;
export type ChatEvent = { type: "user"; message: Message } | { type: "start"; messageId?: string; botId?: string; botName?: string } | { type: "delta"; botId: string; text: string } | { type: "message"; message: Message; botName: string } | { type: "proposal"; proposalId: string } | { type: "summary"; text: string } | { type: "done" } | { type: "error" };
export type Message = { attachments?: Attachment[]; botId?: string | null; parentMessageId?: string | null; id: string; seq: number; role: "user" | "assistant" | "system"; content: string; status: "complete" | "failed" | "running" | "interrupted" | "cancelled"; reactions?: Reaction[]; meta?: MessageMeta };
export type UsedKnowledge = { memories: { id: string; content: string }[]; instructions: { id: string; title: string }[] };
export type ConnectionState = "active" | "revoked" | string;
export type Connection = { id: string; provider: Provider; label: string; state: ConnectionState; revision: number };
export type ConnectionList = { configured: boolean; providers: Provider[]; connections: Connection[] };
export type Requirement = { key: string; provider: Provider; status: "ready" | "missing" | "unusable" };
export type DecisionOption = { label: string; description: string; action: "respond" | "ask_user" | "delegate" | "stop"; targetBotId?: string; reply?: string };
export type DecisionConfig = { backend?: "laya" | "jev"; enabled: boolean; question: string; options: DecisionOption[]; minConfidencePct: number };
export type Route = { action: "respond" | "ask_user" | "delegate" | "stop"; reason?: string; choice?: string; confidence?: number; reply?: string; targetBotId?: string };
export type PreviewPart = { seq: number; role: string; author?: string; content: string; thread?: number; attachments?: string[]; reactions?: Record<string, number> };
export type SnapshotPreview = { title: string; botName: string; parts: PreviewPart[]; previewHash: string };
export type AttentionSummary = { open: number; unread: number; acknowledged: number };

/** An error from the server. `message` is already plain-language; `code` is the stable machine code. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = "ApiError"; }
}
const fallbackMessage = (status: number) => status === 401 ? "Your session ended. Sign in again." : status === 404 ? "That is no longer available." : status === 403 ? "You do not have access to that." : "Something went wrong. Please retry.";
export async function toApiError(response: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string } & Record<string, unknown> } | undefined;
  try { body = await response.json(); } catch { /* not JSON */ }
  const { code, message, ...details } = body?.error ?? {};
  return new ApiError(response.status === 401 ? fallbackMessage(401) : typeof message === "string" && message ? message : fallbackMessage(response.status), response.status, typeof code === "string" ? code : "UNKNOWN", details);
}
export const errorMessage = (e: unknown, fallback = "Something went wrong. Please retry.") => (e instanceof Error && e.message ? e.message : fallback);
export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : undefined);

export async function call<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(new URL(path, ENV.VITE_SERVER_URL), {
    method, credentials: "include", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}

export const chatClient = {
  bots: () => call<{ bots: Bot[] }>("/api/bots").then((r) => r.bots),
  createBot: (input: { name: string; description?: string; visibility?: "private" | "team" }) => call<{ bot: Bot }>("/api/bots", "POST", input).then((r) => r.bot),
  updateBot: (id: string, expectedVersion: number, patch: BotPatch) => call<{ bot: Bot }>(`/api/bots/${id}`, "PATCH", { expectedVersion, patch }).then((r) => r.bot),
  askOnboarding: (id: string, conversationId: string) => call<{ questionId: string }>(`/api/bots/${id}/onboarding/question`, "POST", { conversationId }),
  answerOnboarding: (id: string, input: { conversationId: string; questionId: string; expectedVersion: number; satisfied: boolean }) => call<{ bot: Bot }>(`/api/bots/${id}/onboarding`, "POST", input).then((r) => r.bot),
  conversations: (botId?: string) => call<{ conversations: Conversation[] }>(`/api/conversations${botId ? `?botId=${botId}` : ""}`).then((r) => r.conversations),
  startConversation: (botId: string) => call<{ conversation: Conversation }>("/api/conversations", "POST", { botId }).then((r) => r.conversation),
  messages: (id: string) => call<{ messages: Message[] }>(`/api/conversations/${id}/messages`).then((r) => r.messages),
  workspaces: () => call<{ workspaces: Workspace[] }>("/api/workspaces").then((r) => r.workspaces),
  createWorkspace: (name: string, parentId?: string) => call<{ workspace: Workspace }>("/api/workspaces", "POST", { name, ...(parentId ? { parentId } : {}) }).then((r) => r.workspace),
  proposals: () => call<{ proposals: Proposal[] }>("/api/proposals").then((r) => r.proposals),
  decide: (id: string, approve: boolean) => call<DecisionResult>(`/api/proposals/${id}/decision`, "POST", { approve }),
  moveBot: (id: string, workspaceId: string | null) => call<{ bot: Bot }>(`/api/bots/${id}/workspace`, "POST", { workspaceId }).then((r) => r.bot),
  hooks: (id: string) => call<{ hooks: Hook[] }>(`/api/bots/${id}/hooks`).then((r) => r.hooks),
  addHook: (id: string, hook: { kind: Hook["kind"]; pattern?: string; value?: string }) => call<{ hook: Hook }>(`/api/bots/${id}/hooks`, "POST", hook).then((r) => r.hook),
  updateHook: (id: string, patch: { enabled?: boolean; position?: number; pattern?: string; value?: string }) => call<{ hook: Hook }>(`/api/hooks/${id}`, "PATCH", patch).then((r) => r.hook),
  deleteHook: (id: string) => call(`/api/hooks/${id}`, "DELETE"),
  dryRunHooks: (botId: string, text: string) => call<{ result: HookDryRun }>(`/api/bots/${botId}/hooks/dry-run`, "POST", { text }).then((r) => r.result),
  previewSnapshot: (conversationId: string) => call<{ preview: SnapshotPreview }>("/api/snapshots/preview", "POST", { conversationId }).then((r) => r.preview),
  publishSnapshot: (conversationId: string, previewHash: string) => call("/api/snapshots", "POST", { conversationId, previewHash, requestKey: crypto.randomUUID() }),
  react: (messageId: string, emoji: string) => call(`/api/messages/${messageId}/reactions`, "POST", { emoji }),
  unreact: (messageId: string, emoji: string) => call(`/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, "DELETE"),
  usedKnowledge: (messageId: string) => call<UsedKnowledge>(`/api/messages/${messageId}/knowledge`),
  saveInstruction: (title: string, body: string) => call("/api/instructions", "POST", { title, body }),
  connections: () => call<ConnectionList>("/api/connections"),
  requirements: (botId: string) => call<{ requirements: Requirement[] }>(`/api/bots/${botId}/connections`).then((r) => r.requirements),
  bindConnection: (botId: string, key: string, connectionId: string) => call(`/api/bots/${botId}/connections/${encodeURIComponent(key)}`, "PUT", { connectionId }),
  decisionConfig: (botId: string) => call<{ decision: DecisionConfig | null }>(`/api/bots/${botId}/decision`).then((r) => r.decision),
  saveDecisionConfig: (botId: string, config: DecisionConfig) => call<{ decision: DecisionConfig }>(`/api/bots/${botId}/decision`, "PUT", config).then((r) => r.decision),
  previewDecision: (botId: string, text: string) => call<{ route: Route }>(`/api/bots/${botId}/decision/preview`, "POST", { text }).then((r) => r.route),
  attentionSummary: () => call<{ summary: AttentionSummary }>("/api/attention/summary").then((r) => r.summary),
};

async function readFrames(response: Response, onEvent: (e: ChatEvent) => void, cursor: { last: number }) {
  if (!response.body) throw new Error("no stream");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
      const frame = buffer.slice(0, i); buffer = buffer.slice(i + 2);
      const id = /^id: (\d+)/m.exec(frame)?.[1]; const data = frame.split("\n").find((l) => l.startsWith("data: "));
      if (id) cursor.last = Number(id);
      if (data) onEvent(JSON.parse(data.slice(6)) as ChatEvent);
    }
  }
}

/** Streams one turn over SSE. If the connection drops, the server keeps generating; we reattach by cursor (3 tries), so nothing is duplicated or lost. */
export async function streamTurn(conversationId: string, body: { content: string; clientRequestId: string; parentMessageId?: string; attachmentIds?: string[]; fileRefs?: string[] }, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
  const cursor = { last: 0 };
  let finished = false;
  const track = (e: ChatEvent) => { if (e.type === "done") finished = true; onEvent(e); };
  const first = await fetch(new URL(`/api/conversations/${conversationId}/stream`, ENV.VITE_SERVER_URL), { method: "POST", credentials: "include", cache: "no-store", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!first.ok) throw await toApiError(first);
  try { await readFrames(first, track, cursor); } catch { /* fall through to resume */ }
  for (let attempt = 0; !finished && attempt < 3 && !signal?.aborted; attempt++) {
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    try {
      const again = await fetch(new URL(`/api/conversations/${conversationId}/stream?after=${cursor.last}`, ENV.VITE_SERVER_URL), { credentials: "include", cache: "no-store", signal });
      if (!again.ok || again.headers.get("content-type")?.includes("application/json")) break;
      await readFrames(again, track, cursor);
    } catch { /* retry */ }
  }
  return { finished };
}
export const cancelTurn = (conversationId: string) => call(`/api/conversations/${conversationId}/cancel`, "POST");
export const uploadAttachment = (name: string, text: string, conversationId?: string) => call<{ attachment: Attachment }>("/api/attachments", "POST", { name, mimeType: "text/plain", text, ...(conversationId ? { conversationId } : {}) }).then((r) => r.attachment);
export const listFiles = (path: string) => call<{ entries: { name: string; kind: "file" | "dir" }[] }>(`/api/files?path=${encodeURIComponent(path)}`).then((r) => r.entries);

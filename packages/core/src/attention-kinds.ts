/**
 * What an attention card is about. The server stamps a kind on every card when it raises it, and the web app reads the same table to
 * decide where a card goes: a "decision" waits for you in Inbox, an "fyi" only shows up in Activity > Updates.
 *
 * Only erasable syntax here (no enums, no namespaces): the database schema, the server and the web app all import this file.
 */

export const DECISION_KINDS = [
  /** Legacy `proposal:<id>` cards. The Inbox queue reads proposals from `config_proposal`, so these rows are ignored and drain out. */
  "proposal",
  "task_ask",
  "task_follow",
  "loop_paused",
  "room_stuck",
  "room_failed",
  "room_interrupted",
  "permission_request",
  "routine_failed",
  "routine_blocked",
  "routine_interrupted",
  "trigger_failing",
  "workflow_failed",
  "workflow_interrupted",
  "sign_in",
  "connection_lost",
  "inbound_stopped",
  "inbound_unanswered",
  "inbound_rate",
  "memory_suggestion",
  "bot_ask",
] as const;

export const FYI_KINDS = [
  "background_done",
  "background_failed",
  "memory_updated",
  "memory_stale",
  "turn_slow",
  "room_idle",
  "room_withheld",
  "hook_invalid",
  "agenda_reminder",
  "manual",
  "other",
] as const;

export const ATTENTION_KINDS = [...DECISION_KINDS, ...FYI_KINDS] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];
export type FyiKind = (typeof FYI_KINDS)[number];
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_CATEGORIES = ["decision", "fyi"] as const;
export type AttentionCategory = (typeof ATTENTION_CATEGORIES)[number];

/** Kinds that go in the Inbox queue. Proposals are read from their own table, so the legacy `proposal` cards stay out. */
export const QUEUE_KINDS: readonly DecisionKind[] = DECISION_KINDS.filter((k) => k !== "proposal");

const decisionSet: ReadonlySet<string> = new Set(DECISION_KINDS);

export const isAttentionKind = (v: unknown): v is AttentionKind =>
  typeof v === "string" && (ATTENTION_KINDS as readonly string[]).includes(v);

export const isDecisionKind = (kind: string): kind is DecisionKind => decisionSet.has(kind);

/** Category is derived from the kind and never stored, so the two can not drift apart. */
export const categoryOf = (kind: AttentionKind): AttentionCategory =>
  isDecisionKind(kind) ? "decision" : "fyi";

/** Which cards raise a desktop notification. Decisions always do; a few updates do too (agenda reminders). */
export type NotifyMode = "native" | "none";
export const notifyOf = (kind: AttentionKind): NotifyMode =>
  isDecisionKind(kind) || kind === "agenda_reminder" ? "native" : "none";

/** What the person can do with a decision card without leaving Inbox. */
export const ACT_ACTIONS = [
  "done",
  "resume",
  "nudge",
  "answer",
  "run_again",
  "turn_on",
  "reconnect",
  "accept",
  "open_chat",
] as const;
export type ActAction = (typeof ACT_ACTIONS)[number];

export const DENY_ACTIONS = [
  "wont_do",
  "stop",
  "cancel",
  "deny",
  "pause",
  "leave_off",
  "reject",
  "dismiss",
] as const;
export type DenyAction = (typeof DENY_ACTIONS)[number];

/** `none`: one click. `text`: the person must type something. `optional_text`: a reply may be typed. `proposal`: the card is a pending approval. */
export type ActInput = "none" | "text" | "optional_text" | "proposal";

export type DecisionActions = {
  act: ActAction;
  actLabel: string;
  deny: DenyAction;
  denyLabel: string;
  input: ActInput;
};

const a = (
  act: ActAction,
  actLabel: string,
  deny: DenyAction,
  denyLabel: string,
  input: ActInput = "none",
): DecisionActions => ({ act, actLabel, deny, denyLabel, input });

export const ACTIONS: Record<DecisionKind, DecisionActions> = {
  proposal: a("accept", "Approve", "reject", "Deny", "proposal"),
  task_ask: a("done", "Done", "wont_do", "Won't do", "optional_text"),
  task_follow: a("resume", "Keep following", "stop", "Stop following"),
  loop_paused: a("resume", "Resume", "stop", "Stop loop", "optional_text"),
  room_stuck: a("nudge", "Nudge", "cancel", "Cancel room", "text"),
  room_failed: a("nudge", "Nudge", "cancel", "Cancel room", "text"),
  room_interrupted: a("resume", "Resume", "cancel", "Cancel room"),
  permission_request: a("answer", "Answer", "deny", "Deny", "text"),
  routine_failed: a("run_again", "Run again", "pause", "Pause routine"),
  routine_blocked: a("turn_on", "Turn back on", "leave_off", "Leave paused"),
  routine_interrupted: a("run_again", "Run again", "dismiss", "Dismiss"),
  trigger_failing: a("turn_on", "Turn trigger on", "leave_off", "Leave off"),
  workflow_failed: a("run_again", "Run again", "dismiss", "Dismiss"),
  workflow_interrupted: a("run_again", "Run again", "dismiss", "Dismiss"),
  sign_in: a("open_chat", "Open the browser", "dismiss", "Dismiss"),
  connection_lost: a("reconnect", "Check again", "dismiss", "Dismiss"),
  inbound_stopped: a("turn_on", "Turn on again", "leave_off", "Leave off"),
  inbound_unanswered: a("open_chat", "Open chat", "dismiss", "Dismiss"),
  inbound_rate: a("open_chat", "Open chat", "dismiss", "Dismiss"),
  memory_suggestion: a("accept", "Accept", "reject", "Reject"),
  bot_ask: a("open_chat", "Open chat", "dismiss", "Dismiss"),
};

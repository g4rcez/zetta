import type { UIMessage } from "ai";

import type { Message, PlanStep } from "./chat-client";

/** Data parts the server's UI message stream emits (see apps/server/src/modules/chat/ui-stream.ts). */
export type ZettaData = {
  /** `parentMessageId`: the thread the reply goes into, which can differ from the chat that follows the turn (a queued message). */
  speaker: { messageId: string; botId?: string; botName?: string; parentMessageId?: string };
  saved: { message: Message; botName?: string };
  "user-saved": { message: Message };
  proposal: { proposalId?: string; proposal?: unknown };
  summary: { text: string };
  computer: { messageId: string; botId?: string; vm: { id: string; name: string } };
  "computer-step": { messageId: string; vmId: string; step: string; at: number };
  activity: { messageId: string; label: string; at: number; stepId?: string };
  artifact: { messageId: string; id: string; title: string; at: number };
  plan: { messageId: string; steps: PlanStep[] };
  steer: { messageId: string; noteIds: string[] };
};
export type ZettaUIMessage = UIMessage<unknown, ZettaData>;

/** One line in the Slack-style list: a saved message, or a reply still streaming in. */
export type ComputerStep = { vmId: string; step: string; at: number };
export type Row = Message & {
  createdAt: string;
  botName?: string;
  streaming?: boolean;
  /** What the bot is doing right now between text chunks (a tool call, waiting on the model). */
  activity?: string;
  /** Every step the bot reported this turn, oldest first. Saved replies keep it in `meta.timeline`. */
  timeline?: { at: number; label: string; stepId?: string }[];
  /** The checklist the bot announced this turn. Saved replies keep it in `meta.plan`. */
  plan?: PlanStep[];
  computers?: { id: string; name: string }[];
  computerSteps?: ComputerStep[];
};
/** Computers a bot used on this message: announced live while it works, then kept in the saved receipts. */
export const computersOf = (r: Row) => {
  const seen = new Map((r.computers ?? []).map((c) => [c.id, c]));
  for (const x of r.meta?.receipts ?? [])
    if (x.kind === "computer" && !seen.has(x.id)) seen.set(x.id, { id: x.id, name: x.text });
  return [...seen.values()];
};

const textOf = (m: ZettaUIMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

type UserSavedPart = Extract<ZettaUIMessage["parts"][number], { type: "data-user-saved" }>;

/**
 * Turns the in-flight turn held by useChat into rows. One assistant message can carry several bots (@mentions):
 * each `data-speaker` part opens a new row, and its `data-saved` part (when it arrives) replaces the live text with the canonical message.
 */
export function liveRows(
  messages: ZettaUIMessage[],
  parentMessageId?: string,
  now = new Date().toISOString(),
): Row[] {
  const rows: Row[] = [];
  // The server's saved copy of the user message is the same for every user row: find it once.
  let userSaved: UserSavedPart | undefined;
  for (const m of messages) {
    userSaved = m.parts.find((p): p is UserSavedPart => p.type === "data-user-saved");
    if (userSaved) break;
  }
  for (const m of messages) {
    if (m.role === "user") {
      const saved = userSaved;
      rows.push(
        saved
          ? { ...saved.data.message, createdAt: saved.data.message.createdAt ?? now }
          : {
              id: m.id,
              seq: Number.MAX_SAFE_INTEGER,
              role: "user",
              content: textOf(m),
              status: "complete",
              createdAt: now,
              parentMessageId: parentMessageId ?? null,
            },
      );
      continue;
    }
    if (m.role !== "assistant") continue;
    let current: Row | undefined;
    for (const p of m.parts) {
      if (p.type === "data-speaker") {
        current = {
          id: p.data.messageId,
          seq: Number.MAX_SAFE_INTEGER,
          role: "assistant",
          content: "",
          status: "running",
          createdAt: now,
          botId: p.data.botId ?? null,
          parentMessageId: p.data.parentMessageId ?? parentMessageId ?? null,
          streaming: true,
          ...(p.data.botName ? { botName: p.data.botName } : {}),
        };
        rows.push(current);
      } else if (p.type === "text") {
        if (!current) {
          current = {
            id: `${m.id}:text`,
            seq: Number.MAX_SAFE_INTEGER,
            role: "assistant",
            content: "",
            status: "running",
            createdAt: now,
            parentMessageId: parentMessageId ?? null,
            streaming: true,
          };
          rows.push(current);
        }
        current.content += p.text;
      } else if (p.type === "data-computer") {
        const target = rows.find((r) => r.id === p.data.messageId) ?? current;
        if (target && !target.computers?.some((c) => c.id === p.data.vm.id))
          target.computers = [...(target.computers ?? []), p.data.vm];
      } else if (p.type === "data-activity") {
        const target = rows.find((r) => r.id === p.data.messageId) ?? current;
        if (target) {
          target.activity = p.data.label;
          // A step with an id is its own entry even when the label repeats (two `cd` in a row are two commands).
          if (
            p.data.label !== "Thinking" &&
            (p.data.stepId || target.timeline?.at(-1)?.label !== p.data.label)
          )
            target.timeline = [
              ...(target.timeline ?? []),
              {
                at: p.data.at,
                label: p.data.label,
                ...(p.data.stepId ? { stepId: p.data.stepId } : {}),
              },
            ];
        }
      } else if (p.type === "data-plan") {
        const target = rows.find((r) => r.id === p.data.messageId) ?? current;
        if (target) target.plan = p.data.steps;
      } else if (p.type === "data-artifact") {
        // A file the bot just published: its receipt shows now, not only once the reply is saved.
        const target = rows.find((r) => r.id === p.data.messageId) ?? current;
        if (
          target &&
          !target.meta?.receipts?.some((x) => x.kind === "artifact" && x.id === p.data.id)
        )
          target.meta = {
            ...target.meta,
            receipts: [
              ...(target.meta?.receipts ?? []),
              { kind: "artifact", id: p.data.id, text: p.data.title, created: true },
            ],
          };
      } else if (p.type === "data-computer-step") {
        const target = rows.find((r) => r.id === p.data.messageId) ?? current;
        if (target)
          target.computerSteps = [
            ...(target.computerSteps ?? []),
            { vmId: p.data.vmId, step: p.data.step, at: p.data.at },
          ];
      } else if (p.type === "data-saved") {
        const at = rows.findIndex((r) => r.id === p.data.message.id),
          saved: Row = {
            ...p.data.message,
            createdAt: p.data.message.createdAt ?? now,
            ...(p.data.botName ? { botName: p.data.botName } : {}),
          };
        if (at >= 0)
          rows[at] = {
            ...saved,
            ...(rows[at]!.computerSteps ? { computerSteps: rows[at]!.computerSteps } : {}),
          };
        else rows.push(saved);
        if (current?.id === saved.id) current = undefined;
      }
    }
  }
  return rows;
}

/** An artifact the bot just published opens in the side pane by itself, but only when that cannot cover or replace something else. */
export const shouldAutoOpen = (a: {
  desktop: boolean;
  /** A thread, an artifact or the details pane is already open. */
  paneOpen: boolean;
  /** Artifacts this page already opened (or tried to). */
  seen: ReadonlySet<string>;
  id: string;
  /** When the server published it; a stream replayed on resume carries old times. */
  at: number;
  now?: number;
}) => a.desktop && !a.paneOpen && !a.seen.has(a.id) && (a.now ?? Date.now()) - a.at < 10_000;

/**
 * A live user row keeps the client's id until the server's `user-saved` part arrives. If history reloads first, the saved copy
 * is already there under another id: drop the live one when a recent saved user message has the same text.
 */
export const isSavedUserEcho = (live: Row, saved: Row[], now = Date.now()) =>
  live.role === "user" &&
  live.seq === Number.MAX_SAFE_INTEGER &&
  saved.some(
    (s) =>
      s.role === "user" &&
      s.content === live.content &&
      now - new Date(s.createdAt).getTime() < 60_000,
  );

// A saved message keeps the same Row object while it is unchanged, so memoized rows skip rendering after a reaction or reload.
const rowCache = new WeakMap<Message, Row>();
export const asRow = (m: Message): Row => {
  let row = rowCache.get(m);
  if (!row) {
    row = { ...m, createdAt: m.createdAt ?? new Date(0).toISOString() };
    rowCache.set(m, row);
  }
  return row;
};

/**
 * The rows of a transcript: saved top-level messages, then the live rows that are not saved yet. Every screen that shows a bot
 * conversation builds its rows here. A saved reply still "running" (the page reloaded mid-turn) yields to its live row, which
 * carries the activity, timeline and plan. A live user row already saved under another id is dropped.
 */
export function transcriptRows(saved: Message[], live: Row[]): Row[] {
  const top = saved.filter((m) => !m.parentMessageId).map(asRow);
  const streaming = new Set(live.map((r) => r.id));
  const settled = new Set(top.filter((r) => r.status !== "running").map((r) => r.id));
  const base = top.filter((r) => r.status !== "running" || !streaming.has(r.id));
  const extra = live.filter(
    (r) => !r.parentMessageId && !settled.has(r.id) && !isSavedUserEcho(r, top),
  );
  return extra.length ? [...base, ...extra] : base;
}

export const summaryOf = (messages: ZettaUIMessage[]) => {
  for (const m of messages)
    for (const p of m.parts) if (p.type === "data-summary") return p.data.text;
  return undefined;
};

/** Stable author key: the user, or one bot. */
export const authorOf = (r: Pick<Message, "role" | "botId">, fallbackBotId?: string) =>
  r.role === "user"
    ? "user"
    : r.role === "system"
      ? "system"
      : `bot:${r.botId ?? fallbackBotId ?? ""}`;

export type Grouped<T> = { row: T; continued: boolean; day?: string };
const GROUP_GAP_MS = 5 * 60_000;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function dayLabel(date: Date, now = new Date()): string {
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Parsed timestamp and local-day key per `createdAt`: grouping runs on every streamed chunk and the same strings come back each time. */
const stamps = new Map<string, { ms: number; day: string }>();
const stampOf = (iso: string) => {
  let s = stamps.get(iso);
  if (!s) {
    if (stamps.size > 5000) stamps.clear();
    const d = new Date(iso);
    s = { ms: d.getTime(), day: d.toDateString() };
    stamps.set(iso, s);
  }
  return s;
};

/** Slack grouping: a row continues the previous one when the same author wrote it within 5 minutes on the same day; a day change starts a divider. */
export function groupMessages<T extends Pick<Row, "role" | "botId" | "createdAt">>(
  rows: T[],
  fallbackBotId?: string,
  now = new Date(),
): Grouped<T>[] {
  return rows.map((row, i) => {
    const prev = rows[i - 1],
      at = stampOf(row.createdAt),
      before = prev ? stampOf(prev.createdAt) : undefined;
    const newDay = !before || at.day !== before.day;
    const continued =
      !newDay &&
      !!prev &&
      authorOf(prev, fallbackBotId) === authorOf(row, fallbackBotId) &&
      at.ms - before!.ms < GROUP_GAP_MS;
    return { row, continued, ...(newDay ? { day: dayLabel(new Date(row.createdAt), now) } : {}) };
  });
}

const sameValue = (a: unknown, b: unknown): boolean =>
  Object.is(a, b) ||
  (Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((x, i) => Object.is(x, b[i]) || sameRow(x, b[i])));
const sameRow = (a: unknown, b: unknown): boolean => {
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>,
    keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length && keys.every((k) => k in y && sameValue(x[k], y[k]))
  );
};

/** Streaming rebuilds every live row each chunk: hand back the previous object for rows that did not change, so memoized rows skip rendering. */
export const reuseRows = (prev: Row[], next: Row[]): Row[] => {
  const old = new Map(prev.map((r) => [r.id, r]));
  return next.map((r) => {
    const o = old.get(r.id);
    return o && sameRow(o, r) ? o : r;
  });
};

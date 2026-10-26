import type { UIMessage } from "ai";

import type { Message } from "./chat-client";

/** Data parts the server's UI message stream emits (see apps/server/src/modules/chat/ui-stream.ts). */
export type ZettaData = {
  speaker: { messageId: string; botId?: string; botName?: string };
  saved: { message: Message; botName?: string };
  "user-saved": { message: Message };
  proposal: { proposalId?: string; proposal?: unknown };
  summary: { text: string };
  computer: { messageId: string; botId?: string; vm: { id: string; name: string } };
};
export type ZettaUIMessage = UIMessage<unknown, ZettaData>;

/** One line in the Slack-style list: a saved message, or a reply still streaming in. */
export type Row = Message & { createdAt: string; botName?: string; streaming?: boolean; computers?: { id: string; name: string }[] };
/** Computers a bot used on this message: announced live while it works, then kept in the saved receipts. */
export const computersOf = (r: Row) => { const seen = new Map((r.computers ?? []).map((c) => [c.id, c])); for (const x of r.meta?.receipts ?? []) if (x.kind === "computer" && !seen.has(x.id)) seen.set(x.id, { id: x.id, name: x.text }); return [...seen.values()]; };

const textOf = (m: ZettaUIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

/**
 * Turns the in-flight turn held by useChat into rows. One assistant message can carry several bots (@mentions):
 * each `data-speaker` part opens a new row, and its `data-saved` part (when it arrives) replaces the live text with the canonical message.
 */
export function liveRows(messages: ZettaUIMessage[], parentMessageId?: string): Row[] {
  const rows: Row[] = [], now = new Date().toISOString();
  for (const m of messages) {
    if (m.role === "user") {
      const saved = messages.flatMap((x) => x.parts).find((p) => p.type === "data-user-saved");
      rows.push(saved?.type === "data-user-saved" ? { ...saved.data.message, createdAt: saved.data.message.createdAt ?? now } : { id: m.id, seq: Number.MAX_SAFE_INTEGER, role: "user", content: textOf(m), status: "complete", createdAt: now, parentMessageId: parentMessageId ?? null });
      continue;
    }
    if (m.role !== "assistant") continue;
    let current: Row | undefined;
    for (const p of m.parts) {
      if (p.type === "data-speaker") {
        current = { id: p.data.messageId, seq: Number.MAX_SAFE_INTEGER, role: "assistant", content: "", status: "running", createdAt: now, botId: p.data.botId ?? null, parentMessageId: parentMessageId ?? null, streaming: true, ...(p.data.botName ? { botName: p.data.botName } : {}) };
        rows.push(current);
      } else if (p.type === "text") {
        if (!current) { current = { id: `${m.id}:text`, seq: Number.MAX_SAFE_INTEGER, role: "assistant", content: "", status: "running", createdAt: now, parentMessageId: parentMessageId ?? null, streaming: true }; rows.push(current); }
        current.content += p.text;
      } else if (p.type === "data-computer") {
        const target = rows.find((r) => r.id === p.data.messageId) ?? current;
        if (target && !target.computers?.some((c) => c.id === p.data.vm.id)) target.computers = [...(target.computers ?? []), p.data.vm];
      } else if (p.type === "data-saved") {
        const at = rows.findIndex((r) => r.id === p.data.message.id), saved: Row = { ...p.data.message, createdAt: p.data.message.createdAt ?? now, ...(p.data.botName ? { botName: p.data.botName } : {}) };
        if (at >= 0) rows[at] = saved; else rows.push(saved);
        if (current?.id === saved.id) current = undefined;
      }
    }
  }
  return rows;
}

export const summaryOf = (messages: ZettaUIMessage[]) => {
  for (const m of messages) for (const p of m.parts) if (p.type === "data-summary") return p.data.text;
  return undefined;
};

/** Stable author key: the user, or one bot. */
export const authorOf = (r: Pick<Message, "role" | "botId">, fallbackBotId?: string) => (r.role === "user" ? "user" : `bot:${r.botId ?? fallbackBotId ?? ""}`);

export type Grouped<T> = { row: T; continued: boolean; day?: string };
const GROUP_GAP_MS = 5 * 60_000;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function dayLabel(date: Date, now = new Date()): string {
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** Slack grouping: a row continues the previous one when the same author wrote it within 5 minutes on the same day; a day change starts a divider. */
export function groupMessages<T extends Pick<Row, "role" | "botId" | "createdAt">>(rows: T[], fallbackBotId?: string, now = new Date()): Grouped<T>[] {
  return rows.map((row, i) => {
    const prev = rows[i - 1], at = new Date(row.createdAt), before = prev ? new Date(prev.createdAt) : undefined;
    const newDay = !before || !sameDay(at, before);
    const continued = !newDay && !!prev && authorOf(prev, fallbackBotId) === authorOf(row, fallbackBotId) && at.getTime() - before!.getTime() < GROUP_GAP_MS;
    return { row, continued, ...(newDay ? { day: dayLabel(at, now) } : {}) };
  });
}

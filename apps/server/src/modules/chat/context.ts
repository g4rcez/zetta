import {
  CHAT_SEARCH_LIMIT_MAX,
  SUMMARY_CHARS_MAX,
  SUMMARY_CHARS_MIN,
  SUMMARY_GAP_MAX,
  SUMMARY_GAP_MIN,
} from "@zetta/db/schema/chat";

export type HistoryMessage = {
  id?: string;
  role: string;
  content: string;
  parentMessageId?: string | null;
  status?: string;
  /** Names of pictures attached to the message. */ images?: readonly string[];
};
/** What the bot reads for a message: its text, then one `[image: name]` tag per attached picture (the pixels themselves are not replayed). */
export const withImageTags = (m: Pick<HistoryMessage, "content" | "images">) =>
  [m.content, ...(m.images ?? []).map((n) => `[image: ${n.replace(/[\]\r\n]/g, " ")}]`)]
    .filter(Boolean)
    .join("\n");
/**
 * How much of a chat a turn reads back. Every turn starts a fresh process, so this is all a bot remembers of the chat besides its summary
 * (chat/summary.ts) and its memory. Raised from 8,000 to 24,000 on 2026-11-15; a bot can set its own (`bot.contextBytes`, between the two
 * limits below: the prompt is one command-line argument of about 128 KiB that memory, notes and tool text share).
 */
export const CONTEXT_BYTES_DEFAULT = 24_000;
export const CONTEXT_BYTES_MIN = 4_000;
export const CONTEXT_BYTES_MAX = 60_000;
export const CONTEXT_BYTES = CONTEXT_BYTES_DEFAULT;
/** The budget of one bot's turn. */
export const contextBudget = (b: { contextBytes?: number | null }) =>
  Math.min(CONTEXT_BYTES_MAX, Math.max(CONTEXT_BYTES_MIN, b.contextBytes ?? CONTEXT_BYTES_DEFAULT));

/**
 * The other knobs of a bot's chat memory, with their defaults and limits (the columns of `bot` carry the same limits as checks; a test keeps
 * them equal). Null in the column means the default.
 */
export const SUMMARY_MODES = ["chief", "bot", "off"] as const;
export type SummaryMode = (typeof SUMMARY_MODES)[number];
export const SUMMARY_CHARS_DEFAULT = 2_000;
export const SUMMARY_GAP_DEFAULT = 2_000;
export const CHAT_SEARCH_LIMIT_DEFAULT = 6;
export {
  CHAT_SEARCH_LIMIT_MAX,
  SUMMARY_CHARS_MAX,
  SUMMARY_CHARS_MIN,
  SUMMARY_GAP_MAX,
  SUMMARY_GAP_MIN,
} from "@zetta/db/schema/chat";
type MemoryColumns = {
  summaryMode?: string | null;
  summaryMaxChars?: number | null;
  summaryGapBytes?: number | null;
  chatSearchLimit?: number | null;
};
const within = (v: number | null | undefined, lo: number, hi: number, fallback: number) =>
  Math.min(hi, Math.max(lo, v ?? fallback));
export const summaryMode = (b: MemoryColumns): SummaryMode =>
  (SUMMARY_MODES as readonly string[]).includes(b.summaryMode ?? "")
    ? (b.summaryMode as SummaryMode)
    : "chief";
export const summaryChars = (b: MemoryColumns) =>
  within(b.summaryMaxChars, SUMMARY_CHARS_MIN, SUMMARY_CHARS_MAX, SUMMARY_CHARS_DEFAULT);
export const summaryGap = (b: MemoryColumns) =>
  within(b.summaryGapBytes, SUMMARY_GAP_MIN, SUMMARY_GAP_MAX, SUMMARY_GAP_DEFAULT);
export const chatSearchLimit = (b: MemoryColumns) =>
  within(b.chatSearchLimit, 1, CHAT_SEARCH_LIMIT_MAX, CHAT_SEARCH_LIMIT_DEFAULT);

/**
 * The prompt of a turn is one command-line argument and Linux allows 128 KiB for one. Memory, notes, the summary and the tool text share
 * it with the history, so a freely chosen history size is cut to what is left (see `fitHistory`). A little under the real limit.
 */
export const PROMPT_MAX_BYTES = 120_000;
/** The first `max` bytes of a text, never cutting a character in half. */
export function clipBytes(text: string, max: number) {
  if (max <= 0) return "";
  if (Buffer.byteLength(text) <= max) return text;
  let cut = Buffer.from(text).subarray(0, max).toString("utf8");
  // A character cut in half decodes to U+FFFD at the end: drop it.
  while (cut.endsWith("\uFFFD")) cut = cut.slice(0, -1);
  return cut;
}
/**
 * Drops the oldest messages of the history until the whole prompt fits. `otherBytes` is everything else in the prompt. Returns the
 * messages that stay and whether anything was dropped; at least the newest message stays, clipped, when even that is too much.
 */
export function fitHistory<T extends { role: string; content: string }>(
  past: readonly T[],
  otherBytes: number,
  max = PROMPT_MAX_BYTES,
) {
  const size = (m: T) => Buffer.byteLength(`${m.role}: ${m.content}`) + 1;
  let total = otherBytes + past.reduce((n, m) => n + size(m), 0);
  if (total <= max) return { messages: [...past], dropped: 0 };
  const kept = [...past];
  let dropped = 0;
  while (kept.length > 1 && total > max) {
    total -= size(kept.shift()!);
    dropped++;
  }
  if (total > max && kept.length === 1) {
    const only = kept[0]!;
    const room = Math.max(0, max - otherBytes - only.role.length - 3);
    kept[0] = { ...only, content: clipBytes(only.content, room) };
  }
  return { messages: kept, dropped };
}
/** Newest rows a turn loads for `buildHistory`. The byte budget keeps only a handful in practice; this is the safe upper bound (a row costs at least 7 bytes). */
export const HISTORY_ROWS = 400;

/**
 * Pure turn-context policy. Main-line turns see only main-line messages; a thread turn sees its root and that thread's replies,
 * never sibling threads. Failed/running messages are skipped. The newest messages that fit the byte budget are kept and the cut
 * is visible to the bot. The current user message is NOT part of the history (the caller sends it once as the prompt).
 */
export function buildHistory(
  history: readonly HistoryMessage[],
  opts: { parentMessageId?: string | null; budget?: number } = {},
) {
  const budget = opts.budget ?? CONTEXT_BYTES;
  const root = opts.parentMessageId ?? null;
  const scoped = history.filter(
    (m) =>
      (m.status ?? "complete") === "complete" &&
      (root ? m.id === root || m.parentMessageId === root : !m.parentMessageId),
  );
  const kept: { role: string; content: string }[] = [];
  let used = 0,
    truncated = false;
  for (let i = scoped.length - 1; i >= 0; i--) {
    const m = scoped[i]!,
      text = withImageTags(m);
    const size = Buffer.byteLength(text) + m.role.length + 3;
    if (used + size > budget) {
      truncated = true;
      if (kept.length === 0)
        kept.push({
          role: m.role,
          content: clipBytes(text, Math.max(0, budget - m.role.length - 3)),
        });
      break;
    }
    kept.unshift({ role: m.role, content: text });
    used += size;
  }
  return { messages: kept, truncated };
}

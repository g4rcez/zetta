/**
 * Messages sent while a bot works wait in `chat_queue`. When the turn ends, everything that waits in the same thread is answered by ONE
 * turn, in the order it was sent, so a later message that corrects or cancels an earlier one is read before the bot acts on the first.
 * Pure: the chat service does the reads and writes.
 */

/** One waiting message, oldest first in the list given to `pickBatch`. */
export type Waiting = {
  /** The queue row. */
  id: string;
  messageId: string;
  /** The thread the message was sent into (null: the main line). */
  thread: string | null;
  /** Length of the text, for the size cap. */
  size: number;
};

/** The most messages one turn answers, and the most text they may hold together. Past either, the rest waits for the next turn. */
export const BATCH_MAX_MESSAGES = 20;
export const BATCH_MAX_CHARS = 24_000;

/**
 * The messages the next turn answers: the oldest waiting one and every later one of the same thread, up to the caps. The last of them is
 * the anchor (the row that is marked running and names the turn); the others ride along.
 */
export function pickBatch(
  waiting: readonly Waiting[],
  cap = { messages: BATCH_MAX_MESSAGES, chars: BATCH_MAX_CHARS },
): { anchor: Waiting; earlier: Waiting[] } | undefined {
  const [first] = waiting;
  if (!first) return undefined;
  const picked: Waiting[] = [first];
  let chars = first.size;
  for (const w of waiting.slice(1)) {
    if (w.thread !== first.thread) continue;
    if (picked.length >= cap.messages || chars + w.size > cap.chars) break;
    picked.push(w);
    chars += w.size;
  }
  return { anchor: picked.at(-1)!, earlier: picked.slice(0, -1) };
}

export type BatchMessage = { content: string; quote?: string | undefined };

/** What the bot reads for a batch. One message is passed through untouched, so a single queued message reads exactly as it was typed. */
export function batchPrompt(messages: readonly BatchMessage[]): string {
  const text = (m: BatchMessage) => (m.quote ? `${m.quote}\n\n${m.content}` : m.content);
  if (messages.length === 1) return text(messages[0]!);
  return [
    `The user sent these ${messages.length} messages while you were working, oldest first. Read all of them before you act: a later message may correct, replace or cancel an earlier one, and the latest instruction wins. Do not do something an earlier message asked for if a later one took it back. Answer them together in one reply.`,
    ...messages.map((m, i) => `Message ${i + 1} of ${messages.length}:\n${text(m)}`),
  ].join("\n\n");
}

/** The picks (files, memory items, skills) of every message of a batch, without repeats, in the order they were first named. */
export function joinPicks(inputs: readonly unknown[]): {
  fileRefs: string[];
  memoryIds: string[];
  skills: string[];
} {
  const out = { fileRefs: [] as string[], memoryIds: [] as string[], skills: [] as string[] };
  for (const raw of inputs) {
    const o = (raw ?? {}) as Partial<Record<keyof typeof out, unknown>>;
    for (const key of ["fileRefs", "memoryIds", "skills"] as const) {
      const list = o[key];
      if (!Array.isArray(list)) continue;
      for (const v of list) if (typeof v === "string" && !out[key].includes(v)) out[key].push(v);
    }
  }
  return out;
}

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
export const CONTEXT_BYTES = 8000;

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
          content: text.slice(0, Math.max(0, budget - m.role.length - 3)),
        });
      break;
    }
    kept.unshift({ role: m.role, content: text });
    used += size;
  }
  return { messages: kept, truncated };
}

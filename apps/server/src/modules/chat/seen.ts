/**
 * Read receipts: which bots have picked up a person's message. Nothing is stored for them: every answer already leaves a trace (a
 * room turn that started, a reply row that exists), so the page works the mark out from rows it loads anyway.
 */
type Row = { id: string; seq: number; role: string; parentMessageId: string | null };

/** A turn of a room (`discussion_turn`): one bot woken for one post. */
export type SeenTurn = {
  triggerMessageId: string | null;
  botId: string;
  status: string;
  reasonCode: string | null;
};

/** A turn that started (or ran and ended badly) has read the transcript, so it has read the post that woke it. */
const READ_STATUSES = new Set(["running", "done", "failed", "interrupted"]);

/**
 * Room: the bots whose turn for a post started. A turn that ended as `skipped` with `merged` was covered by a later turn of the same
 * bot, whose prompt holds the whole transcript, so that bot has read the post too. Queued, waiting-for-approval, cancelled and other
 * skipped turns (a bot that is gone) have not. Only a person's posts get an entry; an empty list means nobody has read it yet.
 */
export function seenInRoom(rows: Row[], turns: SeenTurn[]): Map<string, string[]> {
  const byPost = new Map<string, Set<string>>();
  for (const t of turns) {
    if (!t.triggerMessageId) continue;
    if (!READ_STATUSES.has(t.status) && !(t.status === "skipped" && t.reasonCode === "merged"))
      continue;
    const bots = byPost.get(t.triggerMessageId) ?? new Set<string>();
    bots.add(t.botId);
    byPost.set(t.triggerMessageId, bots);
  }
  return new Map(
    rows.filter((r) => r.role === "user").map((r) => [r.id, [...(byPost.get(r.id) ?? [])]]),
  );
}

/**
 * Chat: the bot has picked up a message when it is being answered, or a reply of the bot exists after it in the same place (the main
 * line, or the thread the message was sent in; a queued message is answered on the main line or in the thread it came from).
 * A message still in the queue decides by its own state: `running` and `merged` are being answered, `pending`, `held` and `failed`
 * are not, even when the bot has answered later messages. The queue row is deleted when its answer ends, and then the reply says it.
 */
export function seenInChat(
  rows: Row[],
  botId: string | null,
  queue: ReadonlyMap<string, string>,
): Map<string, string[]> {
  // The newest reply of the bot in each place: the main line is "", a thread is its parent's id.
  const newestReply = new Map<string, number>();
  for (const r of rows) {
    if (r.role !== "assistant") continue;
    const place = r.parentMessageId ?? "";
    if (r.seq > (newestReply.get(place) ?? -1)) newestReply.set(place, r.seq);
  }
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (r.role !== "user") continue;
    const waiting = queue.get(r.id);
    const read = waiting
      ? waiting === "running" || waiting === "merged"
      : (newestReply.get(r.parentMessageId ?? "") ?? -1) > r.seq ||
        (newestReply.get(r.id) ?? -1) > r.seq;
    out.set(r.id, read && botId ? [botId] : []);
  }
  return out;
}

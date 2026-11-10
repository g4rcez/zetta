import type { Receipt } from "./chat-client";

/**
 * One receipt per thing the bot touched. A bot that updates a task twice in one reply, or hands the same member's open task over
 * again, saves two receipts with the same kind and id; rendered as they are they share a React key. The later one wins (newest
 * title, assignee and done-when), it keeps the place of the first, and the thing counts as created when any of them created it.
 */
export function uniqueReceipts(receipts: Receipt[]): Receipt[] {
  const byKey = new Map<string, Receipt>();
  for (const r of receipts) {
    const key = `${r.kind}-${r.id}`;
    const before = byKey.get(key);
    byKey.set(
      key,
      before ? { ...before, ...r, created: (before.created ?? true) || (r.created ?? true) } : r,
    );
  }
  return byKey.size === receipts.length ? receipts : [...byKey.values()];
}

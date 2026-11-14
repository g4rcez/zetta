/**
 * The order Inbox shows its cards in during one visit. The server sends the queue oldest-first and the list changes under the
 * page (new cards arrive, others are decided elsewhere), so the page keeps its own order of keys: what you skipped stays at the back
 * and nothing jumps while you read.
 */

/** Keeps the keys that are still in the queue where they were, and puts new ones at the end in the server's order. */
export function mergeOrder(order: readonly string[], keys: readonly string[]): string[] {
  const live = new Set(keys);
  const kept = [...new Set(order.filter((k) => live.has(k)))];
  const known = new Set(kept);
  return [...kept, ...new Set(keys.filter((k) => !known.has(k)))];
}

/** Skip: the card stays pending and goes to the back. A key that is not in the order changes nothing. */
export function skipKey(order: readonly string[], key: string): string[] {
  if (!order.includes(key)) return [...order];
  return [...order.filter((k) => k !== key), key];
}

/** A deep link (`?item=`) puts that card first. A key that is not in the queue changes nothing. */
export function focusKey(order: readonly string[], key: string | undefined): string[] {
  if (!key || !order.includes(key)) return [...order];
  return [key, ...order.filter((k) => k !== key)];
}

/** "3 of 12": the card in front is number `done + 1` out of everything handled this visit plus everything still waiting. */
export function progressOf(done: number, remaining: number): { position: number; total: number } {
  const total = done + remaining;
  return { position: Math.min(done + 1, Math.max(total, 1)), total };
}

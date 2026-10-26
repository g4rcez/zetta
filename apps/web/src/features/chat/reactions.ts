import type { Reaction } from "./chat-client";

/** Returns the reactions after the user toggles `emoji`: adds/removes their own reaction and keeps counts consistent. Pure. */
export function toggleReaction(reactions: Reaction[] | undefined, emoji: string): Reaction[] {
  const list = reactions ?? [];
  const cur = list.find((r) => r.emoji === emoji);
  if (!cur) return [...list, { emoji, count: 1, mine: true }];
  if (cur.mine) return cur.count <= 1 ? list.filter((r) => r.emoji !== emoji) : list.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r));
  return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
}

/** Bots listed in the sidebar before "All bots"; the page at /bots lists every one. */
export const SIDEBAR_BOT_LIMIT = 7;

import { pickPinned } from "./sidebar-pins";

type Pickable = { id: string; kind: string; name: string };
type Dated = { botId: string; updatedAt: string };

/**
 * Every bot in the sidebar's own order: the chief, then the bots placed by hand (their saved order), then the rest by latest chat,
 * newest first; a bot with no chat comes last and keeps the server's order.
 */
export function rankBots<B extends Pickable>(
  bots: readonly B[],
  chats: readonly Dated[],
  order: readonly string[],
): B[] {
  const latest = new Map<string, string>();
  for (const c of chats) {
    const at = latest.get(c.botId);
    if (!at || c.updatedAt > at) latest.set(c.botId, c.updatedAt);
  }
  const placed = (b: B) => {
    const i = order.indexOf(b.id);
    return i < 0 ? Infinity : i;
  };
  const group = (b: B) => (b.kind === "chief" ? 0 : placed(b) < Infinity ? 1 : 2);
  // Array.sort is stable, so equal bots keep the order the server gave.
  return [...bots].sort((a, z) => {
    if (group(a) !== group(z)) return group(a) - group(z);
    if (group(a) === 1) return placed(a) - placed(z);
    return (latest.get(z.id) ?? "").localeCompare(latest.get(a.id) ?? "");
  });
}

/**
 * The few bots the sidebar lists. Order: the chief, then the bots the person placed by hand (their saved order), then the
 * rest by latest chat, newest first; a bot with no chat comes last and keeps the server's order. In the automatic list the open bot always shows, in
 * the last slot when it would fall outside the cap; a pinned list never adds it, so the person can take it out. A search ignores the cap and lists every bot whose name matches. Bots the person
 * pinned replace all of this: the chief, then the pins in the order pinned (`pickPinned`).
 */
export function pickSidebarBots<B extends Pickable>(
  bots: readonly B[],
  chats: readonly Dated[],
  {
    order,
    currentId,
    query = "",
    limit = SIDEBAR_BOT_LIMIT,
    pinned = [],
  }: {
    order: readonly string[];
    currentId?: string | undefined;
    query?: string;
    limit?: number;
    /** The bots the person pinned (`sidebarBots`). When there are any, the sidebar lists the chief and those, and nothing else. */
    pinned?: readonly string[];
  },
): { shown: B[]; total: number } {
  const ranked = rankBots(bots, chats, order);
  const q = query.trim().toLowerCase();
  if (q) {
    const found = ranked.filter((b) => b.name.toLowerCase().includes(q));
    return { shown: found, total: bots.length };
  }
  const chosen = pickPinned(bots, pinned);
  if (chosen) return { shown: chosen, total: bots.length };
  const shown = ranked.slice(0, limit);
  const open = ranked.find((b) => b.id === currentId);
  if (open && !shown.includes(open)) shown[shown.length - 1] = open;
  return { shown, total: bots.length };
}

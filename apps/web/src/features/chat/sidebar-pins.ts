type Pickable = { id: string; kind: string };

/**
 * The bots a person pinned to the chat sidebar, in the order they pinned them. The chief is never in the list (it is always shown), and a
 * pin of a bot that is gone, or that this person can no longer see, is ignored.
 */
export function pinnedBots<B extends Pickable>(bots: readonly B[], pinned: readonly string[]): B[] {
  const byId = new Map(bots.map((b) => [b.id, b]));
  const out: B[] = [];
  for (const id of pinned) {
    const bot = byId.get(id);
    if (bot && bot.kind !== "chief" && !out.includes(bot)) out.push(bot);
  }
  return out;
}

/**
 * What the sidebar lists when the person pinned bots: the chief first, then the pinned bots in their order. There is no cap, because
 * these are the bots they chose. The open bot is not added: a person can take out the bot whose chat is on screen, and the chat stays open.
 * Returns undefined when nothing is pinned (or every pin is stale): the sidebar then picks by itself, as before.
 */
export function pickPinned<B extends Pickable>(
  bots: readonly B[],
  pinned: readonly string[],
): B[] | undefined {
  const chosen = pinnedBots(bots, pinned);
  if (chosen.length === 0) return undefined;
  return [...bots.filter((b) => b.kind === "chief"), ...chosen];
}

/** The pins after pinning (`on`) or unpinning one bot: a new pin goes last, and a bot is never in the list twice. */
export function withPin(pinned: readonly string[], id: string, on: boolean): string[] {
  const rest = pinned.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

/**
 * The pins after the person pins (`on`) or unpins a bot. When they have pinned nothing yet, the sidebar is showing its own pick, so the
 * pins start from what is on screen (`shown`): the first choice then adjusts the list they see, instead of cutting it down to one bot.
 */
export function nextPins<B extends Pickable>(
  bots: readonly B[],
  pinned: readonly string[],
  shown: readonly Pickable[],
  id: string,
  on: boolean,
): string[] {
  const kept = pinnedBots(bots, pinned).map((b) => b.id);
  const start = kept.length > 0 ? kept : shown.filter((b) => b.kind !== "chief").map((b) => b.id);
  return withPin(start, id, on);
}

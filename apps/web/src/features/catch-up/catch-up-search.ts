/**
 * What Inbox keeps in the address. `bot` is a filter (only what one bot asked). `item` is a deep link that puts one card first,
 * used by a desktop notification and by the dashboard. Defaults stay out of the address and anything not understood is dropped.
 */
export type CatchUpSearch = {
  bot?: string | undefined;
  item?: string | undefined;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BOT = new RegExp(`^${UUID}$`, "i");
const ITEM = new RegExp(`^(proposal|card):${UUID}$`, "i");

export function parseCatchUpSearch(raw: Record<string, unknown>): CatchUpSearch {
  const bot = typeof raw.bot === "string" && BOT.test(raw.bot) ? raw.bot : undefined;
  const item = typeof raw.item === "string" && ITEM.test(raw.item) ? raw.item : undefined;
  return { ...(bot ? { bot } : {}), ...(item ? { item } : {}) };
}

/** The address for one card, for links that live outside the page. */
export const catchUpItemSearch = (key: string): CatchUpSearch => parseCatchUpSearch({ item: key });

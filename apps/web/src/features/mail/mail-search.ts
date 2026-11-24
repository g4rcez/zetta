import { searchText } from "../shared/search-params";

/**
 * The chat panel of the inbox. `open` (the default, so never in the address): wide screens show it as a column beside the open
 * conversation; narrow ones show the mail. `closed`: no column on a wide screen. `focus`: on a narrow screen the chat takes the place of
 * the conversation, with a way back; wide screens show the column.
 */
export const MAIL_PANELS = ["open", "closed", "focus"] as const;
export type MailPanel = (typeof MAIL_PANELS)[number];
export const DEFAULT_MAIL_PANEL: MailPanel = "open";

/**
 * The inbox keeps its view in the address: what was searched (`q`), the open conversation (`c`) and the chat panel (`panel`). Defaults
 * are left out, so the plain address is the whole inbox with nothing open. Pure, so the route and the tests share it.
 */
export type MailSearch = {
  /** Words the mail server searches for. */
  q?: string;
  /** The open conversation: the server's opaque id. */
  c?: string;
  /** The chat panel; absent is `open`. */
  panel?: Exclude<MailPanel, "open">;
};

/** `validateSearch` for the route: anything that is not understood is dropped. */
export function parseMailSearch(raw: Record<string, unknown>): MailSearch {
  const q = searchText(raw.q, 200);
  // The id is opaque (the server accepts up to 4000 characters); one that has spaces or control characters cannot be one of its ids.
  const c = typeof raw.c === "string" && /^[\w.~+/=-]{1,2000}$/.test(raw.c) ? raw.c : undefined;
  const panel = raw.panel === "closed" || raw.panel === "focus" ? raw.panel : undefined;
  return { ...(q ? { q } : {}), ...(c ? { c } : {}), ...(panel ? { panel } : {}) };
}

/** The search after a change: empty values leave the address, so it stays short. */
export function withMailSearch(
  current: MailSearch,
  patch: Partial<Record<keyof MailSearch, string | undefined>>,
) {
  return parseMailSearch({ ...current, ...patch });
}

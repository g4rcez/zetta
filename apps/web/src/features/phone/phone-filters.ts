import {
  PHONE_PROVIDER_IDS,
  type PhoneNumberStatus,
  type PhoneProviderId,
} from "@zetta/core/phone";
import { searchText } from "../shared/search-params";

/** The statuses the Numbers page filters on (a released number is no longer listed). */
export const PHONE_STATUS_FILTERS = [
  "requested",
  "pending_review",
  "active",
  "held",
  "failed",
] as const satisfies readonly PhoneNumberStatus[];
export type PhoneStatusFilter = (typeof PHONE_STATUS_FILTERS)[number];

/** What the address of the Numbers page holds. A filter at its default (all) is left out. */
export type PhoneSearch = {
  status?: PhoneStatusFilter;
  provider?: PhoneProviderId;
  q?: string;
};

/** Drops every value that is not understood, so a hand-edited address never breaks the page. */
export function parsePhoneSearch(raw: Record<string, unknown>): PhoneSearch {
  const status = PHONE_STATUS_FILTERS.find((s) => s === raw.status);
  const provider = PHONE_PROVIDER_IDS.find((p) => p === raw.provider);
  const q = searchText(raw.q, 100);
  return {
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
    ...(q ? { q } : {}),
  };
}

/** The part of a row the filters read. */
export type PhoneFilterRow = {
  status: PhoneNumberStatus;
  provider: PhoneProviderId;
  number: string | null;
  botName: string;
  ownerName: string | null;
};

const digits = (v: string) => v.replace(/\D/g, "");

/** The rows a search keeps, in their order. The text matches the digits of the number, the bot's name and the owner's name. */
export function filterPhoneRows<T extends PhoneFilterRow>(rows: readonly T[], s: PhoneSearch): T[] {
  const q = (s.q ?? "").trim().toLowerCase();
  const qDigits = digits(q);
  return rows.filter((r) => {
    if (s.status && r.status !== s.status) return false;
    if (s.provider && r.provider !== s.provider) return false;
    if (!q) return true;
    if (r.botName.toLowerCase().includes(q)) return true;
    if ((r.ownerName ?? "").toLowerCase().includes(q)) return true;
    return qDigits.length >= 2 && digits(r.number ?? "").includes(qDigits);
  });
}

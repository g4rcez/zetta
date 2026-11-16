/**
 * The chat memory of a bot: how much of a chat it reads back each turn, the summary of what fell out of view, and the search of earlier
 * chats. One place for the defaults and limits the web form validates against; the server keeps the same numbers in
 * `modules/chat/context.ts` and as CHECKs on `bot` (a server test keeps them equal).
 *
 * Only erasable syntax here: the web app, the server and the tests all import this file.
 */

export type Range = { readonly default: number; readonly min: number; readonly max: number };

export const CHAT_MEMORY = {
  /** Bytes of the chat read back on each turn. */
  contextBytes: { default: 24_000, min: 4_000, max: 60_000 },
  /** Characters a summary may have. */
  summaryMaxChars: { default: 2_000, min: 500, max: 6_000 },
  /** Bytes that must fall out of view before the summary is refreshed. */
  summaryGapBytes: { default: 2_000, min: 500, max: 20_000 },
  /** Hits `zetta:chats` returns. */
  chatSearchLimit: { default: 6, min: 1, max: 10 },
} as const satisfies Record<string, Range>;

export const SUMMARY_MODES = ["chief", "bot", "off"] as const;
export type SummaryMode = (typeof SUMMARY_MODES)[number];

/** Shortcuts for the size of the history; a person can type any value in range instead. */
export const CONTEXT_PRESETS = [
  { id: "short", label: "Short", bytes: 8_000, note: "the cheapest" },
  { id: "default", label: "Default", bytes: null, note: "" },
  { id: "long", label: "Long", bytes: 40_000, note: "" },
  { id: "longest", label: "Longest", bytes: 60_000, note: "the most it can read" },
] as const;

/** A rough count of tokens in a number of bytes of ordinary text (about four bytes each; other languages cost more). */
export const approxTokens = (bytes: number) => Math.round(bytes / 4);

export type MemoryField = keyof typeof CHAT_MEMORY;
export type MemoryDraft = {
  /** Text of the number fields as typed; empty means "the default". */
  contextBytes: string;
  summaryMaxChars: string;
  summaryGapBytes: string;
  chatSearchLimit: string;
  summaryMode: SummaryMode;
};
export type MemoryPatch = {
  contextBytes: number | null;
  summaryMaxChars: number | null;
  summaryGapBytes: number | null;
  chatSearchLimit: number | null;
  summaryMode: SummaryMode;
};

const FIELD_NAMES: Record<MemoryField, string> = {
  contextBytes: "How much of the chat it reads back",
  summaryMaxChars: "Summary length",
  summaryGapBytes: "Refresh the summary after",
  chatSearchLimit: "Search results",
};

/** The text of a number field for a value the bot has (empty for the default). */
export const draftOf = (value: number | null | undefined) => (value ? String(value) : "");

/**
 * A draft of the form as a patch, or the message of each field that is not right. An empty field is the default (null). A number is a
 * whole number inside the limits; the thousands separators a person may type (1,000 or 1 000) are accepted.
 */
export function parseMemoryDraft(
  draft: MemoryDraft,
): { ok: true; patch: MemoryPatch } | { ok: false; errors: Partial<Record<MemoryField, string>> } {
  const errors: Partial<Record<MemoryField, string>> = {};
  const patch: Partial<MemoryPatch> = { summaryMode: draft.summaryMode };
  for (const field of Object.keys(CHAT_MEMORY) as MemoryField[]) {
    const raw = draft[field].replace(/[\s,_.](?=\d{3}\b)/g, "").trim();
    if (!raw) {
      patch[field] = null;
      continue;
    }
    const range = CHAT_MEMORY[field];
    const n = Number(raw);
    if (!Number.isInteger(n))
      errors[field] =
        `${FIELD_NAMES[field]} must be a whole number between ${range.min.toLocaleString("en-US")} and ${range.max.toLocaleString("en-US")}.`;
    else if (n < range.min || n > range.max)
      errors[field] =
        `${FIELD_NAMES[field]} must be between ${range.min.toLocaleString("en-US")} and ${range.max.toLocaleString("en-US")}.`;
    else patch[field] = n;
  }
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, patch: patch as MemoryPatch };
}

/** Whether a draft differs from what the bot has now (so Save can stay off until there is something to save). */
export function memoryChanged(
  draft: MemoryDraft,
  saved: {
    contextBytes?: number | null;
    summaryMaxChars?: number | null;
    summaryGapBytes?: number | null;
    chatSearchLimit?: number | null;
    summaryMode?: SummaryMode;
  },
) {
  return (
    draft.contextBytes.trim() !== draftOf(saved.contextBytes) ||
    draft.summaryMaxChars.trim() !== draftOf(saved.summaryMaxChars) ||
    draft.summaryGapBytes.trim() !== draftOf(saved.summaryGapBytes) ||
    draft.chatSearchLimit.trim() !== draftOf(saved.chatSearchLimit) ||
    draft.summaryMode !== (saved.summaryMode ?? "chief")
  );
}

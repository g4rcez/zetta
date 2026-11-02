/** Mentions that address people, not bots. No bot may use one of these names. */
export const RESERVED_MENTIONS = ["user", "channel", "here", "all"] as const;

/** Same normalization as chat @mentions: spaces removed, case-insensitive. */
const key = (name: string) => name.replace(/\s+/g, "").toLowerCase();

export const isReservedBotName = (name: string) =>
  (RESERVED_MENTIONS as readonly string[]).includes(key(name));

const MENTION = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]{1,40})/gu;

/** True when the text addresses the person with a whole `@user` token (not `@username`, not an email). */
export const mentionsUser = (text: string) =>
  [...text.matchAll(MENTION)].some((m) => m[1]!.toLowerCase() === "user");

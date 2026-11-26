/** Which emoji a person reaches for, kept on this device: the picker opens on them. */

/** An emoji and how many times it was picked. The list is kept with the latest pick first. */
export type EmojiUse = [emoji: string, count: number];

/** Two rows of the picker's grid. */
export const FREQUENT_MAX = 16;
const KEPT_MAX = 64;

/** What fills the section before the person has picked enough of their own. */
export const COMMON_EMOJI = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "✅",
  "👀",
  "🙌",
  "👏",
  "🙏",
  "😄",
  "🔥",
  "🚀",
  "💯",
  "🤔",
  "👎",
  "😅",
];

/** What storage holds, minus anything that is not a well formed pick. */
export const parseUses = (raw: unknown): EmojiUse[] =>
  Array.isArray(raw)
    ? raw.filter(
        (x): x is EmojiUse => Array.isArray(x) && typeof x[0] === "string" && Number.isFinite(x[1]),
      )
    : [];

/** The list after one more pick of `emoji`. */
export function countUse(uses: EmojiUse[], emoji: string): EmojiUse[] {
  const before = uses.find(([e]) => e === emoji)?.[1] ?? 0;
  return [[emoji, before + 1] as EmojiUse, ...uses.filter(([e]) => e !== emoji)].slice(0, KEPT_MAX);
}

/**
 * The "Frequently used" emojis: the most picked first (the later pick wins a tie), then `older` (the recent list kept before picks were
 * counted), then the common ones.
 */
export function frequentEmoji(uses: EmojiUse[], older: string[] = []): string[] {
  const picked = [...uses].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  return [...new Set([...picked, ...older, ...COMMON_EMOJI])].slice(0, FREQUENT_MAX);
}

/**
 * fzf-style fuzzy match for device names. Case, accents, spaces and punctuation do not matter: "neo40w", "Neo 40W" and "Lâmpada NEO 40W"
 * all match. Every character of the query must appear in the name in order (like fzf), and the score rewards what a person means:
 * matches at the start of a word, at a letter/digit boundary ("neo|40w") or in one run, and punishes gaps.
 */
const MATCH = 16,
  GAP_START = -3,
  GAP_EXTENSION = -1,
  CONSECUTIVE = 4,
  BOUNDARY = 8,
  CAMEL = 7,
  DIGIT = 7,
  /** fzf doubles the bonus of the first matched character. */
  FIRST = 2;

const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
const isLetter = (ch: string) => /\p{L}/u.test(ch);
const isAlnum = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** The name as lower case letters and digits only, plus the bonus each character earns when it is matched. */
export type Target = { chars: string[]; bonus: number[] };

export function target(name: string): Target {
  const chars: string[] = [];
  const bonus: number[] = [];
  let prev = "";
  for (const ch of strip(name)) {
    if (!isAlnum(ch)) {
      prev = "";
      continue;
    }
    bonus.push(
      prev === ""
        ? BOUNDARY
        : isLetter(prev) !== isLetter(ch)
          ? DIGIT
          : /\p{Ll}/u.test(prev) && /\p{Lu}/u.test(ch)
            ? CAMEL
            : 0,
    );
    chars.push(ch.toLowerCase());
    prev = ch;
  }
  return { chars, bonus };
}

/** Letters and digits only, lower case, no accents: how a query is compared. */
export const compact = (s: string) =>
  strip(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * `score` goes from 0 to 1 (1: a clean run from a word start). `runs` is how many separate pieces of the name the query used:
 * 1 for "neo40w" in "Lâmpada Neo 40W", more for an abbreviation. Undefined: some character of the query is not in the name.
 */
export function fuzzy(query: string, t: Target): { score: number; runs: number } | undefined {
  const q = [...compact(query)];
  const m = q.length;
  const n = t.chars.length;
  if (!m || m > n) return undefined;
  let at = 0;
  for (const c of t.chars) if (c === q[at] && ++at === m) break;
  if (at < m) return undefined;

  const from: number[][] = [];
  let prev: number[] = [];
  let best = -Infinity;
  let bestAt = -1;
  for (let i = 0; i < m; i++) {
    const cur = Array.from({ length: n }, () => -Infinity);
    const src = Array.from({ length: n }, () => -1);
    // The best way to arrive at the current position after skipping characters since the previous match.
    let gap = -Infinity;
    let gapFrom = -1;
    for (let j = 0; j < n; j++) {
      if (t.chars[j] === q[i]) {
        if (i === 0) cur[j] = MATCH + t.bonus[j]! * FIRST;
        else if (j > 0) {
          const run = prev[j - 1]! + CONSECUTIVE;
          if (run >= gap && run > -Infinity) {
            cur[j] = MATCH + t.bonus[j]! + run;
            src[j] = j - 1;
          } else if (gap > -Infinity) {
            cur[j] = MATCH + t.bonus[j]! + gap;
            src[j] = gapFrom;
          }
        }
      }
      if (i > 0 && j > 0) {
        const opened = prev[j - 1]! + GAP_START;
        const extended = gap + GAP_EXTENSION;
        if (opened >= extended) {
          gap = opened;
          gapFrom = j - 1;
        } else gap = extended;
      }
      if (i === m - 1 && cur[j]! > best) {
        best = cur[j]!;
        bestAt = j;
      }
    }
    from.push(src);
    prev = cur;
  }
  if (bestAt < 0) return undefined;
  let runs = 1;
  for (let i = m - 1, j = bestAt; i > 0; i--) {
    const k = from[i]![j]!;
    if (k !== j - 1) runs++;
    j = k;
  }
  const perfect = m * MATCH + BOUNDARY * FIRST + (m - 1) * CONSECUTIVE;
  return { score: Math.min(1, best / perfect), runs };
}

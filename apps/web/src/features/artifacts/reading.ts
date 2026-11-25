/** Pure helpers of the reading aids (reading time and the heading outline of a document). */
export type Heading = { id: string; text: string; level: number };

/** A document with fewer headings than this needs no outline. */
export const MIN_OUTLINE = 3;

const WORDS_PER_MINUTE = 230;
const WORD = /[\p{L}\p{N}]/u;

/** Minutes to read a text, never less than 1. Table pipes, bullets and other marks alone are not words. */
export const readingMinutes = (text: string) =>
  Math.max(1, Math.round(text.split(/\s+/).filter((w) => WORD.test(w)).length / WORDS_PER_MINUTE));

/** An id for a heading. The `doc-` prefix keeps it away from the ids of the app itself. */
export const headingSlug = (text: string) =>
  `doc-${
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  }`;

/** The ids of the headings of one document, in order: a repeated title gets `-2`, `-3`. */
export function headingIds(titles: string[]): string[] {
  const used = new Set<string>();
  return titles.map((title) => {
    const base = headingSlug(title);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

/**
 * Which heading the reader is under: the last one that passed the line near the top of the view. `tops` are the headings' offsets from
 * that line (zero or less: passed). At the end of the document it is the last one, which may never reach the line.
 */
export function activeIndex(tops: number[], atEnd: boolean): number {
  if (atEnd) return tops.length - 1;
  let found = 0;
  for (let i = 0; i < tops.length && tops[i]! <= 0; i++) found = i;
  return found;
}

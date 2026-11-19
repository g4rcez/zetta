import { TIDY } from "@zetta/core/learning";
import { jaccard, tokens } from "./text";

/**
 * What makes two lessons the same, or opposed: word overlap and the words that forbid. Pure, no model (docs/decisions/lessons.md). The
 * tidy-up files what these find as suggestions; nothing here changes anything.
 */

export type LessonLite = { id: string; text: string; createdAt: Date };

const FORBIDS = [
  /\bnever\b/i,
  /\bnunca\b/i,
  /\bjamais\b/i,
  /\bdo not\b/i,
  /\bdon'?t\b/i,
  /\bnao\b/i,
  /\bavoid\b/i,
  /\bstop\b/i,
  /\bwithout\b/i,
  /\bsem\b/i,
];
const MARKERS = new Set([
  "never",
  "nunca",
  "jamais",
  "always",
  "sempre",
  "avoid",
  "stop",
  "without",
  "sem",
  "nao",
  "must",
  "only",
]);

const strip = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** The lesson forbids something ("never…", "don't…", "nunca…"). */
export const forbids = (text: string) => FORBIDS.some((r) => r.test(strip(text)));
/** What a lesson is about, without the words that only say how strongly. */
const subject = (text: string) =>
  tokens(text)
    .filter((w) => !MARKERS.has(w))
    .join(" ");

export type Pair = { a: LessonLite; b: LessonLite; score: number };

const older = (x: LessonLite, y: LessonLite): [LessonLite, LessonLite] =>
  x.createdAt.getTime() <= y.createdAt.getTime() ? [x, y] : [y, x];

/** Lessons that say the same thing: enough of their words in common. The older one comes first (it is the one to keep). */
export function duplicateLessons(lessons: readonly LessonLite[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < lessons.length; i++)
    for (let j = i + 1; j < lessons.length; j++) {
      const score = jaccard(lessons[i]!.text, lessons[j]!.text);
      if (score >= TIDY.lessonDuplicate) {
        const [a, b] = older(lessons[i]!, lessons[j]!);
        out.push({ a, b, score });
      }
    }
  return out;
}

/**
 * Lessons that may pull in opposite directions: about the same thing (their subjects share enough words), and one forbids what the other
 * asks. Only a flag to look at, never a verdict: "never use tables for sales" and "send the sales report as a table" are a real pair,
 * "never answer late" and "answer in Portuguese" are not, and word overlap cannot always tell them apart.
 */
export function conflictingLessons(lessons: readonly LessonLite[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < lessons.length; i++)
    for (let j = i + 1; j < lessons.length; j++) {
      const x = lessons[i]!,
        y = lessons[j]!;
      if (forbids(x.text) === forbids(y.text)) continue;
      const score = jaccard(subject(x.text), subject(y.text));
      // The same lesson in other words is a duplicate, not a conflict.
      if (score >= TIDY.lessonConflict && jaccard(x.text, y.text) < TIDY.lessonDuplicate) {
        const [a, b] = older(x, y);
        out.push({ a, b, score });
      }
    }
  return out;
}

/** The key that makes a suggestion about the same things appear once, whatever the order of its refs. */
export const refHash = (refs: readonly { id: string }[]) =>
  refs
    .map((r) => r.id)
    .sort()
    .join(":");

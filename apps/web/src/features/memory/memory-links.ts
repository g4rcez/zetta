import { RELATION, type Item, type Relation } from "./memory-api";
import { splitMemoryLinks } from "./memory-markdown";

const OPEN = /\[\[(?:(related|depends-on|part-of|supersedes):)?([a-z0-9-]{0,80})$/;
export const RELATIONS = Object.keys(RELATION) as Relation[];
const MAX_CANDIDATES = 8;

/** `[[slug]]` for a plain link, `[[relation:slug]]` for a typed one. */
export const formatLink = (relation: Relation, slug: string) =>
  relation === "related" ? `[[${slug}]]` : `[[${relation}:${slug}]]`;

/** The link being typed right before the caret (`[[`, `[[dep`, `[[depends-on:ac`), or undefined when the caret is not in one. */
export function matchMemoryLink(text: string, caret: number) {
  const before = text.slice(0, caret);
  const m = OPEN.exec(before);
  return m ? { relation: m[1] as Relation | undefined, query: m[2]!, at: m.index } : undefined;
}

/** Replaces the link being typed with a finished one; a closing `]]` already after the caret is taken in. */
export function insertLink(
  text: string,
  caret: number,
  at: number,
  relation: Relation,
  slug: string,
) {
  const link = formatLink(relation, slug);
  const after = text.slice(caret).replace(/^\]\]/, "");
  return { text: text.slice(0, at) + link + after, caret: at + link.length };
}

/** Adds a link as its own line at the end. A link that is already there (same relation and item) is not added again. */
export function appendLink(content: string, relation: Relation, slug: string) {
  const have = (splitMemoryLinks(content) ?? []).some(
    (p) => p.slug === slug && p.relation === relation,
  );
  return have
    ? content
    : `${content.trimEnd()}\n\n${RELATION[relation]}: ${formatLink(relation, slug)}`;
}

/** Items to offer for what was typed after `[[`: title or slug starts with it first, then contains it, then the most important. */
export function linkCandidates(
  items: readonly Item[],
  query: string,
  self?: string,
  skip: ReadonlySet<string> = new Set(),
) {
  const q = query.trim().toLowerCase();
  const rank = (i: Item) => {
    const slug = i.slug.toLowerCase(),
      title = i.title.toLowerCase();
    if (!q) return 2;
    if (slug.startsWith(q) || title.startsWith(q)) return 0;
    if (slug.includes(q) || title.includes(q)) return 1;
    return undefined;
  };
  return items
    .filter((i) => i.slug !== self && i.status !== "archived" && !skip.has(i.slug))
    .flatMap((i) => {
      const r = rank(i);
      return r === undefined ? [] : [{ i, r }];
    })
    .sort((a, b) => a.r - b.r || b.i.score - a.i.score || a.i.title.localeCompare(b.i.title))
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.i);
}

import { describeDays } from "../studio/routine-schedule";
import type { GrokListItem, ScheduleDraft } from "./grok-api";

/** The catalog narrowed by the search words (all of them, in any order, over name, creator and summary) and one category. */
export function filterCatalog(
  items: readonly GrokListItem[],
  q: string,
  category: string,
): GrokListItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (category && !i.categories.includes(category)) return false;
    const haystack = `${i.name} ${i.creatorName} ${i.summary}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** The categories of a catalog: the most common first, ties by name. */
export function categoriesOf(items: readonly GrokListItem[]): string[] {
  const count = new Map<string, number>();
  for (const i of items) for (const c of i.categories) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/** A routine's schedule in words, for the review. Reads the same as the server's wording. */
export function describeSchedule(s: ScheduleDraft, timezone: string): string {
  if (s.kind === "interval") return `every ${s.everyMinutes} minutes`;
  if (s.kind === "daily") return `${describeDays(s.weekdays)} at ${s.dailyAt} (${timezone})`;
  return s.expression
    ? `no schedule Zetta can run yet (${s.expression})`
    : "no schedule we could read";
}

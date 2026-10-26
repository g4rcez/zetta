export type CalendarItem = { at: string; routineId: string; title: string; kind: "scheduled" | "ran"; status?: string };

/** Local-date key (YYYY-MM-DD) so the calendar groups by the viewer's day, not UTC. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function groupByDay(items: readonly CalendarItem[]) {
  const map = new Map<string, CalendarItem[]>();
  for (const i of items) { const k = dayKey(new Date(i.at)); map.set(k, [...(map.get(k) ?? []), i]); }
  for (const list of map.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return map;
}

/** The visible month plus a one-week margin on each side (calendar grids show neighbouring days), within the server's 62-day cap. */
export function monthRange(d: Date) {
  const from = new Date(d.getFullYear(), d.getMonth(), 1 - 7);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 7);
  return { from, to };
}

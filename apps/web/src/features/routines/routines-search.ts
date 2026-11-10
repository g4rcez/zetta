/** The routines page's view, kept in the address so a reload, Back and a shared link show the same thing. */
export type RoutinesSearch = {
  /** A routine to show open and scrolled into view (`/routines?routine=<id>`). */
  routine?: string;
  /** The calendar instead of the list and timeline. Absent: the list. */
  view?: "calendar";
  /** The timeline's window in hours. Absent: 3. */
  hours?: 12 | 24;
};

export function parseRoutinesSearch(search: Record<string, unknown>): RoutinesSearch {
  const out: RoutinesSearch = {};
  if (typeof search.routine === "string" && /^[0-9a-f-]{36}$/i.test(search.routine))
    out.routine = search.routine;
  if (search.view === "calendar") out.view = "calendar";
  const hours = Number(search.hours);
  if (hours === 12 || hours === 24) out.hours = hours;
  return out;
}

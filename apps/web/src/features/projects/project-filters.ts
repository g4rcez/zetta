import { PROJECT_STATUSES, type Project, type ProjectStatus } from "./projects-api";

/** Which projects the list shows: the ones still going (the default), every one, or one status. */
export const PROJECT_SHOW = ["current", "all", ...PROJECT_STATUSES.map((s) => s.status)] as const;
export type ProjectShow = (typeof PROJECT_SHOW)[number];

export type ProjectSearch = { query?: string; show?: ProjectShow; label?: string };
export type ProjectFilterState = { query: string; show: ProjectShow; label: string };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The address to the filters. Defaults are left out and anything not understood is dropped. */
export function parseProjectSearch(raw: Record<string, unknown>): ProjectSearch {
  const out: ProjectSearch = {};
  const query = text(raw.query, 80);
  if (query) out.query = query;
  const show = PROJECT_SHOW.find((s) => s === raw.show);
  if (show && show !== "current") out.show = show;
  const label = text(raw.label, 32).toLowerCase();
  if (label) out.label = label;
  return out;
}
export const toProjectState = (s: ProjectSearch): ProjectFilterState => ({
  query: s.query ?? "",
  show: s.show ?? "current",
  label: s.label ?? "",
});
export const toProjectSearch = (s: ProjectFilterState): ProjectSearch =>
  parseProjectSearch({ query: s.query, show: s.show, label: s.label });

const CURRENT: readonly ProjectStatus[] = ["active", "paused"];
/** Projects that need the reader first, then the newest change. */
const ORDER = { needs_you: 0, quiet: 1, on_track: 2, on_hold: 3, done: 4 } as const;

export function applyProjectFilters(projects: Project[], f: ProjectFilterState): Project[] {
  const q = f.query.toLowerCase();
  return projects
    .filter(
      (p) =>
        (f.show === "all" ||
          (f.show === "current" ? CURRENT.includes(p.status) : p.status === f.show)) &&
        (!f.label || p.labels.includes(f.label)) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.outcome.toLowerCase().includes(q) ||
          p.labels.some((l) => l.includes(q))),
    )
    .sort(
      (a, b) =>
        ORDER[a.health.state] - ORDER[b.health.state] || b.updatedAt.localeCompare(a.updatedAt),
    );
}

/** Every label in use, for the label filter. */
export const projectLabels = (projects: Project[]) =>
  [...new Set(projects.flatMap((p) => p.labels))].sort();

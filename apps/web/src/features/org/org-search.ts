import type { OrgPosition } from "./org-api";

/** How the Organization page draws the chart: the canvas, or an outline that also works on a phone and with a screen reader. */
export const ORG_VIEWS = ["chart", "list"] as const;
export type OrgViewMode = (typeof ORG_VIEWS)[number];

/** Whom the page points out: everyone, or only the people, or only the bots. The others stay, dimmed. */
export const ORG_SHOW = ["everyone", "people", "bots"] as const;
export type OrgShow = (typeof ORG_SHOW)[number];

export type OrgSearch = { view?: OrgViewMode; q?: string; show?: OrgShow; focus?: string };
export type OrgFilterState = { view: OrgViewMode; q: string; show: OrgShow; focus: string };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The address to the filters. Defaults are left out and anything not understood is dropped. */
export function parseOrgSearch(raw: Record<string, unknown>): OrgSearch {
  const out: OrgSearch = {};
  const view = ORG_VIEWS.find((v) => v === raw.view);
  if (view && view !== "chart") out.view = view;
  const q = text(raw.q, 80);
  if (q) out.q = q;
  const show = ORG_SHOW.find((s) => s === raw.show);
  if (show && show !== "everyone") out.show = show;
  const focus = text(raw.focus, 64);
  if (/^[0-9a-f-]{8,64}$/i.test(focus)) out.focus = focus.toLowerCase();
  return out;
}
export const toOrgState = (s: OrgSearch): OrgFilterState => ({
  view: s.view ?? "chart",
  q: s.q ?? "",
  show: s.show ?? "everyone",
  focus: s.focus ?? "",
});
export const toOrgSearch = (s: OrgFilterState): OrgSearch =>
  parseOrgSearch({ view: s.view, q: s.q, show: s.show, focus: s.focus });

/** Whether any filter points seats out. */
export const filtering = (f: Pick<OrgFilterState, "q" | "show">) => !!f.q || f.show !== "everyone";

/** The words a search reads on a seat: its title, unit and the name of whoever holds it (or held it). */
export const seatWords = (p: OrgPosition) =>
  [p.title, p.unit, p.holder?.name ?? "", p.problem?.was ?? "", p.team?.name ?? ""]
    .join(" ")
    .toLowerCase();

/** Whether a seat is one the filters point out. */
export function matchesFilters(p: OrgPosition, f: Pick<OrgFilterState, "q" | "show">): boolean {
  const q = f.q.toLowerCase();
  if (q && !seatWords(p).includes(q)) return false;
  if (f.show === "people") return p.seat === "person";
  if (f.show === "bots") return p.seat === "bot";
  return true;
}

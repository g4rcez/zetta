import { isUuid, searchText } from "../shared/search-params";
import type { Author, Hit, Item, Row, SharedRow, Status, WikiType } from "./wiki-api";

export const SORTS = ["relevance", "updated", "created", "score", "title"] as const;
export type Sort = (typeof SORTS)[number];
export const SINCE = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 } as const;
export type Since = keyof typeof SINCE;
const TYPES: readonly WikiType[] = ["solo", "owner", "teams", "all"];
const STATUSES: readonly Status[] = ["current", "stale", "archived"];
const AUTHORS: readonly Author[] = ["user", "bot", "system"];

/** What the address holds. Lists are comma separated so the URL stays readable. */
export type WikiSearch = {
  q?: string;
  view?: "list" | "graph";
  /** How the graph is drawn; flat when absent. */
  dim?: "3d";
  type?: string;
  tag?: string;
  tagMode?: "all";
  status?: string;
  access?: "own" | "shared";
  by?: Author;
  bot?: string;
  team?: string;
  min?: number;
  max?: number;
  since?: Since;
  sort?: Sort;
  /** Opens the editor of the item page. */
  create?: string;
};
/** The same facets as values the filter functions use. */
export type WikiFilter = {
  q: string;
  types: WikiType[];
  tags: string[];
  tagMode: "any" | "all";
  statuses: Status[];
  access?: "own" | "shared";
  by?: Author;
  bot?: string;
  team?: string;
  min?: number;
  max?: number;
  since?: Since;
  sort: Sort;
};

const list = <T extends string>(v: unknown, allowed?: readonly T[], max = 12): T[] =>
  typeof v === "string"
    ? (
        [
          ...new Set(
            v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        ].filter((x) => !allowed || (allowed as readonly string[]).includes(x)) as T[]
      ).slice(0, max)
    : [];
const score = (v: unknown) => {
  if (typeof v === "string" && !v.trim()) return undefined; // an empty number field is no limit, not 0
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100 ? n : undefined;
};

/** Drops every value that is not valid, so a hand-edited address never breaks the page. */
export function parseWikiSearch(raw: Record<string, unknown>): WikiSearch {
  const type = list(raw.type, TYPES),
    tag = list(raw.tag),
    status = list(raw.status, STATUSES),
    min = score(raw.min),
    max = score(raw.max),
    q = searchText(raw.q, 200),
    create = searchText(raw.create, 160);
  return {
    ...(q ? { q } : {}),
    ...(raw.view === "graph" && { view: "graph" as const }),
    ...(raw.view === "graph" && raw.dim === "3d" && { dim: "3d" as const }),
    ...(type.length && { type: type.join(",") }),
    ...(tag.length && { tag: tag.join(",") }),
    ...(raw.tagMode === "all" && tag.length > 1 && { tagMode: "all" as const }),
    ...(status.length && { status: status.join(",") }),
    ...((raw.access === "own" || raw.access === "shared") && { access: raw.access }),
    ...(AUTHORS.includes(raw.by as Author) && { by: raw.by as Author }),
    ...(isUuid(raw.bot) && { bot: raw.bot }),
    ...(isUuid(raw.team) && { team: raw.team }),
    ...(min !== undefined && { min }),
    ...(max !== undefined && { max }),
    ...(typeof raw.since === "string" && raw.since in SINCE && { since: raw.since as Since }),
    ...(SORTS.includes(raw.sort as Sort) && { sort: raw.sort as Sort }),
    ...(create ? { create } : {}),
  };
}

export const filterOf = (s: WikiSearch): WikiFilter => ({
  q: s.q ?? "",
  types: list(s.type, TYPES),
  tags: list(s.tag),
  tagMode: s.tagMode === "all" ? "all" : "any",
  statuses: list(s.status, STATUSES),
  ...(s.access && { access: s.access }),
  ...(s.by && { by: s.by }),
  ...(s.bot && { bot: s.bot }),
  ...(s.team && { team: s.team }),
  ...(s.min !== undefined && { min: s.min }),
  ...(s.max !== undefined && { max: s.max }),
  ...(s.since && { since: s.since }),
  // With a text the server ranks the results; without one the list is newest first.
  sort: s.sort ?? (s.q ? "relevance" : "updated"),
});

/** How many facets narrow the list (the text, the sort and the view do not count). */
export const activeCount = (f: WikiFilter) =>
  [
    f.types.length,
    f.tags.length,
    f.statuses.length,
    f.access,
    f.by,
    f.bot,
    f.team,
    f.min !== undefined || f.max !== undefined,
    f.since,
  ].filter(Boolean).length;

export function mergeRows(pages: readonly Row[], shared: readonly SharedRow[]): Item[] {
  return [
    ...pages.map((r): Item => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      type: r.type,
      howto: r.howto,
      tags: r.tags,
      score: r.score,
      status: r.status,
      access: "own",
      by: r.updatedBy,
      ownerName: null,
      botId: r.updatedBy === "bot" ? r.updatedByBotId : null,
      teams: r.teams,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    ...shared.map((r): Item => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      type: r.type,
      howto: r.howto,
      tags: r.tags,
      score: r.score,
      status: r.status,
      access: "shared",
      by: null,
      ownerName: r.ownerName,
      botId: null,
      teams: [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  ];
}

export function matches(item: Item, f: WikiFilter, now = Date.now()) {
  const q = f.q.trim().toLowerCase();
  if (
    q &&
    !`${item.title} ${item.howto} ${item.slug} ${item.tags.join(" ")}`.toLowerCase().includes(q)
  )
    return false;
  if (f.types.length && !f.types.includes(item.type)) return false;
  if (f.statuses.length ? !f.statuses.includes(item.status) : item.status === "archived")
    return false;
  if (f.tags.length) {
    const has = (t: string) => item.tags.includes(t);
    if (f.tagMode === "all" ? !f.tags.every(has) : !f.tags.some(has)) return false;
  }
  if (f.access && item.access !== f.access) return false;
  if (f.by && item.by !== f.by) return false;
  if (f.bot && item.botId !== f.bot) return false;
  if (f.team && !item.teams.includes(f.team)) return false;
  if (f.min !== undefined && item.score < f.min) return false;
  if (f.max !== undefined && item.score > f.max) return false;
  if (f.since && Date.parse(item.updatedAt) < now - SINCE[f.since] * 86_400_000) return false;
  return true;
}

export function sortItems(items: readonly Item[], sort: Sort): Item[] {
  const by: Record<Sort, (a: Item, b: Item) => number> = {
    relevance: () => 0,
    updated: (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    created: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    score: (a, b) => b.score - a.score || a.title.localeCompare(b.title),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return [...items].sort(by[sort]);
}

/** Tags of the items, most used first. */
export function tagCounts(items: readonly Item[]) {
  const counts = new Map<string, number>();
  for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The query string of a server search: the facets of the address, as GET /api/wiki accepts them. */
export function searchQuery(s: WikiSearch) {
  const p = new URLSearchParams();
  const put = (k: string, v: string | number | undefined) =>
    v !== undefined && v !== "" && p.set(k, String(v));
  put("q", s.q);
  put("type", s.type);
  put("status", s.status);
  put("tag", s.tag);
  put("tagMode", s.tagMode);
  put("access", s.access);
  put("by", s.by);
  put("bot", s.bot);
  put("team", s.team);
  put("min", s.min);
  put("max", s.max);
  put("since", s.since);
  return p.toString();
}

/** A server search result as an item of the list. A result has no creation time; the last update stands in. */
export function itemOfHit(h: Hit): Item {
  return {
    id: h.id,
    slug: h.slug,
    title: h.title,
    type: h.type,
    howto: h.howto,
    tags: h.tags,
    score: h.score,
    status: h.status,
    access: h.access,
    by: null,
    ownerName: h.ownerName,
    botId: null,
    teams: [],
    createdAt: h.updatedAt,
    updatedAt: h.updatedAt,
    why: h.why,
    neighbors: h.neighbors,
  };
}

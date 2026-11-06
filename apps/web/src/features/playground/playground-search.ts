import { isUuid, searchText } from "../shared/search-params";

/**
 * The playground list keeps its view in the URL: what was searched and whose playgrounds are listed.
 * Defaults are left out, so the plain address is the default view. Pure, so the route and the tests share it.
 */
export type PlaygroundsSearch = {
  q?: string;
  /** Playgrounds shared with the team. Absent: the caller's own. */
  scope?: "team";
};
export function parsePlaygroundsSearch(raw: Record<string, unknown>): PlaygroundsSearch {
  const q = searchText(raw.q, 200);
  return { ...(q ? { q } : {}), ...(raw.scope === "team" ? { scope: "team" as const } : {}) };
}
export function withPlaygroundsSearch(
  current: PlaygroundsSearch,
  patch: Partial<Record<keyof PlaygroundsSearch, string | undefined>>,
) {
  return parsePlaygroundsSearch({ ...current, ...patch });
}

/** One playground keeps the open file and the run on screen in the URL, so a reload and a shared link show the same view. */
export type PlaygroundSearch = {
  /** The path of the open file. Absent: the entry file. */
  file?: string;
  /** The run on screen. Absent: the latest one. */
  run?: string;
  /** The tab of the right panel. Absent: the output. */
  panel?: "inputs" | "runs";
};
export function parsePlaygroundSearch(raw: Record<string, unknown>): PlaygroundSearch {
  const file = searchText(raw.file, 300);
  return {
    ...(file ? { file } : {}),
    ...(isUuid(raw.run) ? { run: raw.run } : {}),
    ...(raw.panel === "inputs" || raw.panel === "runs" ? { panel: raw.panel } : {}),
  };
}
export function withPlaygroundSearch(
  current: PlaygroundSearch,
  patch: Partial<Record<keyof PlaygroundSearch, string | undefined>>,
) {
  return parsePlaygroundSearch({ ...current, ...patch });
}

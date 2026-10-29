import type { Artifact } from "./artifacts-api";

/** A routine that publishes the same title every run makes versions of one thing: the first row in list order leads, the rest are its older versions. */
export type VersionGroup = { head: Artifact; older: Artifact[] };

export function groupVersions(rows: readonly Artifact[]): VersionGroup[] {
  const groups = new Map<string, VersionGroup>();
  for (const a of rows) {
    const key = `${a.botId ?? ""}\u0000${a.title.trim().toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.older.push(a);
    else groups.set(key, { head: a, older: [] });
  }
  return [...groups.values()];
}

import { searchText } from "../shared/search-params";

/**
 * The status filter of the plugin list. `installed` is the default and is left out of the address. A built-in plugin ships with Zetta and
 * needs no configuration, but it is not on by default: it counts as installed once the person activates it, like any plugin. `builtin`
 * lists the built-in ones, activated or not.
 */
export const PLUGIN_STATUSES = ["installed", "available", "builtin", "all"] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];
export const PLUGIN_STATUS_LABEL: Record<PluginStatus, string> = {
  installed: "Installed",
  available: "Available",
  builtin: "Built in",
  all: "All",
};

/** What the address of the Plugins tab holds. A filter at its default is left out. */
export type PluginsSearch = {
  /** Words in the name, the description or the id. */
  q?: string;
  /** Absent: installed. */
  status?: Exclude<PluginStatus, "installed">;
  /** A category of the catalog. Absent: all of them. */
  category?: string;
};

const CATEGORY = /^[a-z][a-z0-9-]{0,39}$/;

/** Drops every value that is not understood, so a hand-edited address never breaks the page. */
export function parsePluginsSearch(raw: Record<string, unknown>): PluginsSearch {
  // Kept as typed: the box shows what the address holds, so trimming here would swallow the space typed between two words.
  const q = typeof raw.q === "string" && raw.q.trim() ? raw.q.slice(0, 100) : undefined;
  const category = searchText(raw.category, 40);
  const status = (["available", "builtin", "all"] as const).find((s) => s === raw.status);
  return {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(category && category !== "all" && CATEGORY.test(category) ? { category } : {}),
  };
}

/** The search after a change: empty values and defaults leave the address, so it stays short. */
export function withPluginsSearch(
  current: PluginsSearch,
  patch: {
    q?: string | undefined;
    status?: PluginStatus | undefined;
    category?: string | undefined;
  },
): PluginsSearch {
  return parsePluginsSearch({ ...current, ...patch });
}

type Row = { id: string; name: string; description: string; category: string; builtin?: boolean };

const isInstalled = (m: Row, installedIds: ReadonlySet<string>) => installedIds.has(m.id);

/** How many plugins each status holds, over the whole catalog (the buttons show it whatever else is filtered). */
export function pluginCounts(
  catalog: readonly Row[],
  installedIds: ReadonlySet<string>,
): Record<PluginStatus, number> {
  return {
    installed: catalog.filter((m) => isInstalled(m, installedIds)).length,
    available: catalog.filter((m) => !isInstalled(m, installedIds)).length,
    builtin: catalog.filter((m) => m.builtin).length,
    all: catalog.length,
  };
}

/** The plugins a search keeps: installed ones first, then in the order of the catalog. */
export function filterPlugins<T extends Row>(
  catalog: readonly T[],
  installedIds: ReadonlySet<string>,
  s: PluginsSearch,
): T[] {
  const status = s.status ?? "installed";
  const needle = (s.q ?? "").trim().toLowerCase();
  return catalog
    .filter(
      (m) =>
        (status === "all" ||
          (status === "builtin"
            ? !!m.builtin
            : isInstalled(m, installedIds) === (status === "installed"))) &&
        (!s.category || m.category === s.category) &&
        `${m.name} ${m.description} ${m.id}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(isInstalled(b, installedIds)) - Number(isInstalled(a, installedIds)));
}

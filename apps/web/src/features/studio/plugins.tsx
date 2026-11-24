import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { Button, Input } from "@/components/ui";
import { PluginIcon } from "../plugins/plugin-icon";
import { probeKey, StatusBadge, useProbes } from "../plugins/plugin-parts";
import { CATEGORY_LABEL, usePlugins, type PluginMeta } from "../plugins/plugins-api";
import { identityQueries } from "../identity/identity-queries";
import { PLUGINS_WITH_SERVER_SETUP } from "../plugins/plugin-server-section";
import { Empty } from "../shared/ui";
import {
  filterPlugins,
  pluginCounts,
  PLUGIN_STATUS_LABEL,
  PLUGIN_STATUSES,
  withPluginsSearch,
  type PluginsSearch,
} from "./plugins-filters";

/**
 * Studio > Plugins: one filterable list of every plugin; installed ones carry a tag and their status. Installing and configuring happen on
 * the plugin's own page. The filters are the caller's: the Studio tab keeps them in the address, the setup flow in its own state.
 */
export function Plugins({
  onError,
  search,
  setSearch,
}: {
  onError: (m: string) => void;
  search: PluginsSearch;
  /** Typing in the search replaces the address entry; choosing a status or a category adds one. */
  setSearch: (next: PluginsSearch, how: "push" | "replace") => void;
}) {
  const { catalog, installed } = usePlugins(onError);
  const { probes, probe } = useProbes();
  const navigate = useNavigate();
  const { data: identity } = useQuery(identityQueries.status());
  const admin = identity?.state === "active" && identity.isAdmin;
  const status = search.status ?? "installed";
  const category = search.category ?? "all";
  const byId = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c])), [catalog]);
  const installedIds = useMemo(() => new Set((installed ?? []).map((i) => i.id)), [installed]);
  const open = (m: PluginMeta) =>
    void navigate({ to: "/plugins/$pluginId", params: { pluginId: m.id } });

  // Remote and native plugins are checked automatically; local commands (npx) only on their page, since a check starts the process.
  useEffect(() => {
    for (const i of installed ?? []) {
      const scope = i.sharing === "team" ? "team" : "mine";
      if (byId.get(i.id)?.transport !== "stdio" && !probes[probeKey(i.id, scope)])
        void probe(i.id, scope);
    }
  }, [installed, byId, probes, probe]);

  const categories = useMemo(
    () => ["all", ...new Set((catalog ?? []).map((c) => c.category))],
    [catalog],
  );
  const counts = pluginCounts(catalog ?? [], installedIds);
  const needle = (search.q ?? "").trim();
  const shown = filterPlugins(catalog ?? [], installedIds, search);

  return (
    <section aria-label="Plugins" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          title="Search"
          hiddenLabel
          container="min-w-48 flex-1"
          value={search.q ?? ""}
          onChange={(e) => setSearch(withPluginsSearch(search, { q: e.target.value }), "replace")}
          placeholder="Sentry, GitHub, browser..."
        />
        <div role="group" aria-label="Status" className="flex gap-1">
          {PLUGIN_STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              aria-pressed={status === s}
              onClick={() => setSearch(withPluginsSearch(search, { status: s }), "push")}
            >
              {PLUGIN_STATUS_LABEL[s]} <span className="tabular-nums opacity-70">{counts[s]}</span>
            </Button>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Category" className="flex flex-wrap gap-1">
        {categories.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={category === c ? "secondary" : "ghost"}
            aria-pressed={category === c}
            onClick={() => setSearch(withPluginsSearch(search, { category: c }), "push")}
          >
            {c === "all" ? "All categories" : (CATEGORY_LABEL[c] ?? c)}
          </Button>
        ))}
      </div>
      {catalog === undefined || installed === undefined ? (
        <Empty>Loading...</Empty>
      ) : shown.length === 0 ? (
        <Empty>
          {status === "installed" && !needle && category === "all"
            ? "Nothing installed yet. Switch to Available to pick a plugin."
            : "No plugins match."}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((m) => {
            const hasMine = (installed ?? []).some((i) => i.id === m.id && i.sharing === "private");
            const hasTeam = (installed ?? []).some((i) => i.id === m.id && i.sharing === "team");
            // The status shown is the user's own configuration, or the team's when that is all there is.
            const p = probes[probeKey(m.id, hasMine ? "mine" : "team")];
            const done = installedIds.has(m.id);
            return (
              <div key={m.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <PluginIcon id={m.id} name={m.icon} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.builtin && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                        Built in
                      </span>
                    )}
                    {done ? (
                      <>
                        {hasMine && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                            {m.builtin ? "Active" : "Installed"}
                          </span>
                        )}
                        {hasTeam && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                            Team
                          </span>
                        )}
                        <StatusBadge probe={p} />
                      </>
                    ) : null}
                  </div>
                </div>
                <p
                  className="line-clamp-2 flex-1 text-xs text-muted-foreground"
                  title={m.description}
                >
                  {m.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {CATEGORY_LABEL[m.category] ?? m.category}
                </p>
                {done && p && p !== "loading" && p.status.detail && (
                  <p
                    className={`text-xs ${p.status.state === "connected" ? "text-success" : "text-destructive"}`}
                  >
                    {p.status.detail}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  {m.docsUrl ? (
                    <a
                      href={m.docsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs underline"
                    >
                      Docs <ArrowSquareOutIcon aria-hidden className="size-3" />
                    </a>
                  ) : (
                    <span />
                  )}
                  {done ? (
                    <Button size="sm" variant="outline" onClick={() => open(m)}>
                      Manage
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      {/* A built-in plugin with settings for the whole server: the administrator reaches them before activating it. */}
                      {m.builtin && admin && PLUGINS_WITH_SERVER_SETUP.has(m.id) && (
                        <Button size="sm" variant="outline" onClick={() => open(m)}>
                          Manage
                        </Button>
                      )}
                      <Button size="sm" onClick={() => open(m)}>
                        {m.builtin ? "Activate" : "Install"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

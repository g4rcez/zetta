import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Button, Input } from "@/components/ui";
import { PluginIcon } from "../plugins/plugin-icon";
import { probeKey, StatusBadge, useProbes } from "../plugins/plugin-parts";
import { CATEGORY_LABEL, usePlugins, type PluginMeta } from "../plugins/plugins-api";
import { Empty } from "../shared/ui";

type Status = "installed" | "available" | "all";
const STATUS_LABEL: Record<Status, string> = {
  installed: "Installed",
  available: "Available",
  all: "All",
};

/** Studio > Plugins: one filterable list of every plugin; installed ones carry a tag and their status. Installing and configuring happen on the plugin's own page. */
export function Plugins({ onError }: { onError: (m: string) => void }) {
  const { catalog, installed } = usePlugins(onError);
  const { probes, probe } = useProbes();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<Status>("installed");
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

  const isInstalled = (m: PluginMeta) => !!m.always || installedIds.has(m.id);
  const categories = useMemo(
    () => ["all", ...new Set((catalog ?? []).map((c) => c.category))],
    [catalog],
  );
  const counts: Record<Status, number> = {
    installed: (catalog ?? []).filter(isInstalled).length,
    available: (catalog ?? []).filter((c) => !isInstalled(c)).length,
    all: (catalog ?? []).length,
  };
  const needle = query.trim().toLowerCase();
  const shown = (catalog ?? [])
    .filter(
      (c) =>
        (status === "all" || isInstalled(c) === (status === "installed")) &&
        (category === "all" || c.category === category) &&
        `${c.name} ${c.description} ${c.id}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(isInstalled(b)) - Number(isInstalled(a)));

  return (
    <section aria-label="Plugins" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          title="Search"
          hiddenLabel
          container="min-w-48 flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sentry, GitHub, browser..."
        />
        <div role="group" aria-label="Status" className="flex gap-1">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {STATUS_LABEL[s]} <span className="tabular-nums opacity-70">{counts[s]}</span>
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
            onClick={() => setCategory(c)}
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
            const done = isInstalled(m);
            return (
              <div key={m.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <PluginIcon id={m.id} name={m.icon} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.always ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                        Built in
                      </span>
                    ) : done ? (
                      <>
                        {hasMine && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                            Installed
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
                  {m.always ? (
                    <span className="text-xs text-muted-foreground">On for every bot</span>
                  ) : done ? (
                    <Button size="sm" variant="outline" onClick={() => open(m)}>
                      Manage
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => open(m)}>
                      Install
                    </Button>
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

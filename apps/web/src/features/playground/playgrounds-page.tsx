import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Input, Select } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { relativeTime } from "../shared/relative-time";
import { Badge, Empty, field, list, listItem, Loading } from "../shared/ui";
import { Segmented } from "../tasks/task-filter-bar";
import {
  playgroundApi,
  playgroundQueries,
  RUNNER_LABEL,
  STARTER,
  type PlaygroundLanguage,
} from "./playground-api";
import type { PlaygroundsSearch } from "./playground-search";

/** The person's playgrounds, and the ones shared with the team. The search and the scope are in the address. */
export function PlaygroundsPage({
  search,
  setSearch,
  onOpen,
  renderLink,
}: {
  search: PlaygroundsSearch;
  setSearch: (
    patch: Partial<Record<keyof PlaygroundsSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  onOpen: (id: string) => void;
  /** The route draws each row as a router link, so opening a playground does not reload the app. */
  renderLink: (id: string, children: React.ReactNode) => React.ReactNode;
}) {
  const qc = useQueryClient();
  const scope = search.scope ?? "mine";
  const found = useQuery(playgroundQueries.list(scope, search.q));
  const languages = useQuery(playgroundQueries.languages());
  const [q, setQ] = useState(search.q ?? "");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<PlaygroundLanguage>("typescript");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // The search box waits for a pause in typing before it changes the address, and typing replaces the history entry.
  useEffect(() => {
    if (q.trim() === (search.q ?? "")) return;
    const t = setTimeout(() => setSearch({ q: q.trim() || undefined }, { replace: true }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const entry = languages.data?.find((l) => l.id === language)?.defaultEntry;
    if (!entry) return;
    setBusy(true);
    setError(undefined);
    try {
      const made = await playgroundApi.create({
        title: title.trim(),
        language,
        files: [{ path: entry, content: STARTER[language] }],
      });
      void qc.invalidateQueries({ queryKey: ["playground", "list"] });
      onOpen(made.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="space-y-1">
            <h1>Playground</h1>
            <p className="text-sm text-muted-foreground">
              Code you and your bots write, run and keep: reports and small scripts.
            </p>
          </div>
          <Button size="sm" aria-expanded={creating} onClick={() => setCreating(!creating)}>
            New playground
          </Button>
        </header>
        {creating && (
          <form onSubmit={create} className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 sm:max-w-sm">
              <Input
                title="Title"
                required
                autoFocus
                maxLength={120}
                placeholder="Monthly report"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <Select
              title="Language"
              required={false}
              value={language}
              onChange={(e) => setLanguage(e.target.value as PlaygroundLanguage)}
              options={(languages.data ?? []).map((l) => ({ value: l.id, label: l.label }))}
            />
            <Button type="submit" disabled={busy || !title.trim() || !languages.data}>
              Create
            </Button>
          </form>
        )}
        {error && <Alert theme="danger">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          {/* Same height as the search box: both are h-8, as the controls of the Memory filters. */}
          <div className="[&>div]:h-8">
            <Segmented
              label="Whose playgrounds"
              value={scope}
              onChange={(v) => setSearch({ scope: v === "team" ? "team" : undefined })}
              options={[
                { value: "mine", label: "Mine" },
                { value: "team", label: "Shared with the team" },
              ]}
            />
          </div>
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              aria-label="Search playgrounds"
              placeholder="Search by title"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              // The component library sets `input { font-size: 16px }` outside any layer, so only an important utility keeps this at 14px.
              className={`${field} h-8 py-0 pl-9 text-sm!`}
            />
          </div>
        </div>
        {found.error && <Alert theme="danger">{errorMessage(found.error)}</Alert>}
        {found.isLoading ? (
          <Loading />
        ) : (found.data ?? []).length === 0 ? (
          <Empty>
            {search.q
              ? "No playground matches this search."
              : scope === "team"
                ? "Nobody shared a playground with the team yet."
                : "You have no playgrounds yet. Create one, or ask a bot to write a script."}
          </Empty>
        ) : (
          <ul className={list}>
            {(found.data ?? []).map((p) => (
              <li key={p.id} className={listItem}>
                {renderLink(
                  p.id,
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                    <Badge>{p.language}</Badge>
                    <Badge>{RUNNER_LABEL[p.runner]}</Badge>
                    {p.visibility === "team" && <Badge tone="info">Team</Badge>}
                    {p.createdByBotId && <Badge tone="neutral">Made by a bot</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {scope === "team" ? `${p.ownerName} · ` : ""}
                      {relativeTime(p.updatedAt)}
                    </span>
                  </span>,
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

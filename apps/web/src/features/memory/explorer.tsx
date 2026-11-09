import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpenTextIcon,
  FilePlusIcon,
  GraphIcon,
  ListIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { Drawer } from "@/components/drawer";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";
import { CompanyDocs } from "../studio/company-docs";
import { Sources } from "../studio/sources";
import { errorMessage } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Empty, Loading } from "../shared/ui";
import { Segmented } from "../tasks/task-filter-bar";
import { teamsQueries } from "../teams/teams-api";
import { FiltersBar } from "./filters-bar";
import { Fold } from "./fold";
import { HealthPanel } from "./health-panel";
import { AskBox } from "./ask-box";
import { useMemoryGraph } from "./use-memory-graph";
import { Fields, contentFields, metaFields } from "./item-fields";
import { Results } from "./results";
import { SuggestionsPanel } from "./suggestions-panel";
import { useAction } from "./use-action";
import { useMemoryIndex } from "./use-memory-index";
import { useMemorySearch } from "./use-memory-search";
import { call } from "../chat/chat-client";
import { createItem } from "./memory-api";
import {
  activeCount,
  filterOf,
  matches,
  parseMemorySearch,
  sortItems,
  tagCounts,
  type MemorySearch,
} from "./memory-filters";

const VIEWS = [
  { value: "list", label: "List", icon: <ListIcon aria-hidden className="size-4" /> },
  { value: "graph", label: "Graph", icon: <GraphIcon aria-hidden className="size-4" /> },
] as const;

const GraphView = lazy(() => import("./graph-view").then((m) => ({ default: m.GraphView })));

/** The memory as a whole: find items with filters, write a new one, and see what needs work. */
export function MemoryExplorer({ search }: { search: MemorySearch }) {
  const tf = useTimeFormat();
  const navigate = useNavigate();
  const { items, memoryLinks, error, reload } = useMemoryIndex();
  const botsQuery = useQuery(chatQueries.bots());
  const teamsQuery = useQuery(teamsQueries.list());
  const bots = botsQuery.data;
  const teams = teamsQuery.data;
  const listFailure = botsQuery.error ?? teamsQuery.error;
  // CompanyDocs and Sources report their own load errors here.
  const [panelError, setListError] = useState<string>();
  const listError = panelError ?? (listFailure ? errorMessage(listFailure) : undefined);
  const [creating, setCreating] = useState(search.create !== undefined);
  const filter = useMemo(() => filterOf(search), [search]);
  // With a text the server ranks and filters; without one the list is filtered here.
  const found = useMemorySearch(search);
  const shown = useMemo(() => {
    if (found.active)
      return found.items && !found.loading ? sortItems(found.items, filter.sort) : undefined;
    return items
      ? sortItems(
          items.filter((i) => matches(i, filter)),
          filter.sort,
        )
      : undefined;
  }, [found.active, found.items, found.loading, items, filter]);
  const tags = useMemo(() => tagCounts(items ?? []), [items]);
  const graphOn = search.view === "graph";
  const graph = useMemoryGraph(graphOn);
  const hits = useMemo(
    () =>
      found.active && found.items && !found.loading
        ? new Set(found.items.map((i) => i.id))
        : undefined,
    [found.active, found.items, found.loading],
  );
  const active = activeCount(filter);

  const go = useCallback(
    (next: MemorySearch) => void navigate({ to: "/memory", search: next as never, replace: true }),
    [navigate],
  );
  // `parseMemorySearch` keeps only valid values, so a facet set to "" or undefined leaves the address.
  const set = useCallback(
    (next: Record<string, unknown>) => go(parseMemorySearch({ ...search, ...next })),
    [go, search],
  );
  const clear = () => go(parseMemorySearch({ q: search.q, sort: search.sort, view: search.view }));
  const closeCreate = () => {
    setCreating(false);
    if (search.create !== undefined) set({ create: undefined });
  };

  const { run, feedback } = useAction();
  /** Creates the conventions item from the default text when there is none, then opens it: it tells bots how the memory is organized. */
  const openConventions = () =>
    void run(async () => {
      const r = await call<{ slug: string }>("/api/memory-conventions", "POST", {});
      await navigate({ to: "/memory/$slug", params: { slug: r.slug } });
    }, "");
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { ...contentFields(f), ...metaFields(f) };
    void run(async () => {
      await createItem(body);
      setCreating(false);
      set({ create: undefined });
    }, "Saved.");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
        <header className="flex items-center justify-between gap-3">
          <h1>Memory</h1>
          <div className="flex items-center gap-3">
            <Segmented
              label="View"
              value={search.view ?? "list"}
              options={[...VIEWS]}
              onChange={(v) => set({ view: v === "graph" ? "graph" : undefined, dim: undefined })}
            />
            <Button variant="outline" onClick={() => void navigate({ to: "/memory-add" })}>
              <FilePlusIcon aria-hidden="true" />
              Add source
            </Button>
            <Button variant="outline" onClick={openConventions}>
              <BookOpenTextIcon aria-hidden="true" />
              Conventions
            </Button>
            <Button onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden="true" />
              New item
            </Button>
          </div>
        </header>
        <div className="space-y-3">
          <HealthPanel bots={bots} />
          <Fold title="Connected sources">
            <p className="text-sm text-muted-foreground">
              Google Drive documents become memory items (tag drive, read only) and feeds are read
              by your workflows.
            </p>
            <CompanyDocs onError={setListError} />
            <Sources onError={setListError} />
          </Fold>
        </div>
        <AskBox
          memoryLinks={memoryLinks}
          scope={
            (active > 0 || search.q) && shown?.length
              ? { ids: shown.map((i) => i.id), label: "Only use the items listed below" }
              : undefined
          }
        />
        <div className="min-w-0 space-y-4">
          <FiltersBar
            search={search}
            filter={filter}
            set={set}
            clear={clear}
            active={active}
            tags={tags}
            bots={bots}
            teams={teams}
            shown={shown?.length ?? 0}
            total={found.active ? shown?.length : items?.length}
          />
          <SuggestionsPanel />
          {found.active && found.meaning === false && !found.loading && (
            <p className="text-xs text-muted-foreground">
              Search by meaning is off, so only words and tags are matched.
            </p>
          )}
          {graphOn && !(error || listError || found.error) ? (
            graph.error ? (
              <p role="alert" className="text-sm text-destructive">
                {graph.error}{" "}
                <Button size="xs" variant="outline" onClick={() => void graph.reload()}>
                  Try again
                </Button>
              </p>
            ) : !graph.data ? (
              <Loading />
            ) : (
              <Suspense fallback={<Loading />}>
                <GraphView
                  data={graph.data}
                  filter={filter}
                  hits={hits}
                  dim={search.dim === "3d" ? "3d" : "2d"}
                  setDim={(d) => set({ dim: d === "3d" ? "3d" : undefined })}
                />
              </Suspense>
            )
          ) : error || listError || found.error ? (
            <p role="alert" className="text-sm text-destructive">
              {error ?? listError ?? found.error}{" "}
              <Button size="xs" variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            </p>
          ) : !shown ? (
            <Loading />
          ) : items?.length === 0 ? (
            <Empty>
              Nothing here yet. Your bots add items when they learn something, or you can{" "}
              <button type="button" className="underline" onClick={() => setCreating(true)}>
                write one
              </button>
              .
            </Empty>
          ) : shown.length === 0 ? (
            <Empty>
              No item matches.{" "}
              <button type="button" className="underline" onClick={clear}>
                Clear the filters
              </button>
              .
            </Empty>
          ) : (
            <Results
              items={shown}
              bots={bots}
              when={(iso) => formatDateTime(iso, tf)}
              onTag={(tag) => set({ tag: [...new Set([...filter.tags, tag])].join(",") })}
            />
          )}
        </div>
      </div>
      <Drawer
        open={creating}
        onClose={closeCreate}
        title="New item"
        description="Write an item your bots can find. The title becomes its name in [[links]]. Never save passwords or keys."
      >
        <form onSubmit={add} className="space-y-2">
          <Fields
            meta
            items={items}
            bots={bots}
            teams={teams}
            page={{ title: search.create ?? "", howto: "", content: "", tags: [] }}
          />
          <Button type="submit">Save item</Button>
          {feedback}
        </form>
      </Drawer>
    </div>
  );
}

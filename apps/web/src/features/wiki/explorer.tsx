import { useNavigate } from "@tanstack/react-router";
import { CaretRightIcon, GraphIcon, ListIcon, PlusIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { Drawer } from "@/components/drawer";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";
import { CompanyDocs } from "../studio/company-docs";
import { Sources } from "../studio/sources";
import { Empty, Loading, useList } from "../shared/ui";
import { Segmented } from "../tasks/task-filter-bar";
import { FiltersBar } from "./filters-bar";
import { HealthPanel } from "./health-panel";
import { AskBox } from "./ask-box";
import { useWikiGraph } from "./use-wiki-graph";
import { Fields, contentFields, metaFields } from "./item-fields";
import { Results } from "./results";
import { SuggestionsPanel } from "./suggestions-panel";
import { useAction } from "./use-action";
import { useWikiIndex } from "./use-wiki-index";
import { useWikiSearch } from "./use-wiki-search";
import { createItem, type Bot, type TeamName } from "./wiki-api";
import {
  activeCount,
  filterOf,
  matches,
  parseWikiSearch,
  sortItems,
  tagCounts,
  type WikiSearch,
} from "./wiki-filters";

const VIEWS = [
  { value: "list", label: "List", icon: <ListIcon aria-hidden className="size-4" /> },
  { value: "graph", label: "Graph", icon: <GraphIcon aria-hidden className="size-4" /> },
] as const;

const GraphView = lazy(() => import("./graph-view").then((m) => ({ default: m.GraphView })));

/** The wiki as a whole: find items with filters, write a new one, and see what needs work. */
export function WikiExplorer({ search }: { search: WikiSearch }) {
  const tf = useTimeFormat();
  const navigate = useNavigate();
  const { items, wikiLinks, error, reload } = useWikiIndex();
  const [listError, setListError] = useState<string>();
  const [bots] = useList<Bot>("/api/bots", "bots", setListError);
  const [teams] = useList<TeamName>("/api/teams", "teams", setListError);
  const [creating, setCreating] = useState(search.create !== undefined);
  const filter = useMemo(() => filterOf(search), [search]);
  // With a text the server ranks and filters; without one the list is filtered here.
  const found = useWikiSearch(search);
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
  const graph = useWikiGraph(graphOn);
  const hits = useMemo(
    () =>
      found.active && found.items && !found.loading
        ? new Set(found.items.map((i) => i.id))
        : undefined,
    [found.active, found.items, found.loading],
  );
  const active = activeCount(filter);

  const go = useCallback(
    (next: WikiSearch) => void navigate({ to: "/wiki", search: next as never, replace: true }),
    [navigate],
  );
  // `parseWikiSearch` keeps only valid values, so a facet set to "" or undefined leaves the address.
  const set = useCallback(
    (next: Record<string, unknown>) => go(parseWikiSearch({ ...search, ...next })),
    [go, search],
  );
  const clear = () => go(parseWikiSearch({ q: search.q, sort: search.sort, view: search.view }));
  const closeCreate = () => {
    setCreating(false);
    if (search.create !== undefined) set({ create: undefined });
  };

  const { run, feedback } = useAction(reload);
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
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="space-y-1">
            <h1>Wiki</h1>
            <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
              What your bots know, linked together. They search it before they start work and add to
              it when they finish. Never save passwords or keys here.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Segmented
              label="View"
              value={search.view ?? "list"}
              options={[...VIEWS]}
              onChange={(v) => set({ view: v === "graph" ? "graph" : undefined, dim: undefined })}
            />
            <Button onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden="true" />
              New item
            </Button>
          </div>
        </header>
        <AskBox
          wikiLinks={wikiLinks}
          scope={
            (active > 0 || search.q) && shown?.length
              ? { ids: shown.map((i) => i.id), label: "Only use the items listed below" }
              : undefined
          }
        />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
          <div className="min-w-0 space-y-8 lg:border-l lg:pl-8">
            <SuggestionsPanel />
            <HealthPanel bots={bots} />
          </div>
        </div>
        <details className="group border-t pt-4">
          <summary className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md text-sm font-medium select-none hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
            <CaretRightIcon
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
            />
            Connected sources
          </summary>
          <p className="mt-1 text-sm text-muted-foreground">
            Google Drive documents become wiki items (tag drive, read only) and feeds are read by
            your workflows.
          </p>
          <div className="mt-4 space-y-6">
            <CompanyDocs onError={setListError} />
            <Sources onError={setListError} />
          </div>
        </details>
      </div>
      <Drawer
        open={creating}
        onClose={closeCreate}
        title="New item"
        description="Write an item your bots can find. The title becomes its name in [[links]]."
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

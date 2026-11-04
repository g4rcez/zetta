import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { Empty, Loading, field } from "../shared/ui";
import { readGraphColors } from "./graph-colors";
import { GraphBoundary } from "./graph-boundary";
import { GraphPreview } from "./graph-preview";
import { canDrawWebgl, useReducedMotion, useSize } from "./use-size";
import { linkKey } from "./graph-types";
import {
  buildGraph,
  neighborhood,
  summary,
  type ColorBy,
  type GNode,
  type GraphData,
} from "./wiki-graph";
import { filterOf, parseWikiSearch, type WikiFilter } from "./wiki-filters";

// The libraries are large (three.js most of all): they load when a graph is first shown, and the 3D one only on request.
const Graph2D = lazy(() => import("./graph-2d"));
const Graph3D = lazy(() => import("./graph-3d"));
const NO_FILTER = filterOf(parseWikiSearch({}));

// See filters-bar.tsx: the library forces 16px on inputs, so `text-sm!` is needed.
const control = cn(field, "h-8 py-0 text-sm!");
const pill = (on: boolean) =>
  cn(
    "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
    on
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
  );

/** Every item the person can read as a graph: flat by default, in space on request. Filters and search dim what does not match. */
export function GraphView({
  data,
  filter,
  hits,
  dim,
  setDim,
  focusSlug,
  height = "h-[32rem]",
  controls = true,
}: {
  data: GraphData;
  filter?: WikiFilter;
  /** Search results to mark. */
  hits?: ReadonlySet<string> | undefined;
  dim: "2d" | "3d";
  setDim?: (d: "2d" | "3d") => void;
  /** The item that is shown on its own page, marked in the drawing. */
  focusSlug?: string | undefined;
  height?: string;
  controls?: boolean;
}) {
  const navigate = useNavigate();
  const id = useId();
  const [box, size] = useSize<HTMLDivElement>();
  const reduced = useReducedMotion();
  const webgl = useMemo(canDrawWebgl, []);
  const [colorBy, setColorBy] = useState<ColorBy>("type");
  const [labels, setLabels] = useState(true);
  const [missing, setMissing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [fit, setFit] = useState(1);
  const [focus, setFocus] = useState<{ id: string; n: number }>();
  const [selected, setSelected] = useState<string>();
  const [hover, setHover] = useState<string>();
  const [theme, setTheme] = useState(0);
  const [find, setFind] = useState("");
  const flat = dim === "2d" || !webgl;

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    // A theme switch changes the class on <html>; the drawing reads the colors again.
    const mo = new MutationObserver(() => setTheme((t) => t + 1));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => {
      document.removeEventListener("visibilitychange", on);
      mo.disconnect();
    };
  }, []);

  const graph = useMemo(
    () => buildGraph(data, { filter: filter ?? NO_FILTER, colorBy, hits, showMissing: missing }),
    [data, filter, colorBy, hits, missing],
  );
  // The library moves and rewires what it gets, so it gets a copy that changes only with the structure, not with every filter.
  const base = useMemo(
    () => buildGraph(data, { filter: NO_FILTER, colorBy: "type", showMissing: missing }),
    [data, missing],
  );
  const shape = useMemo(
    () => ({ nodes: base.nodes.map((n) => ({ ...n })), links: base.links.map((l) => ({ ...l })) }),
    [base],
  );
  const style = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const faintLinks = useMemo(() => new Set(graph.links.filter((l) => l.dim).map(linkKey)), [graph]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `theme` is the signal that the tokens changed
  const colors = useMemo(() => readGraphColors(graph.legend), [graph.legend, theme]);
  const near = useMemo(() => (hover ? neighborhood(base.links, hover) : undefined), [base, hover]);
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const current = focusSlug
    ? graph.nodes.find((n) => n.slug === focusSlug && !n.missing)
    : undefined;
  const picked = selected ? style.get(selected) : undefined;
  const open = (n: GNode) =>
    n.missing
      ? void navigate({ to: "/memory", search: { create: n.slug } as never })
      : void navigate({ to: "/memory/$slug", params: { slug: n.slug } });

  const jump = (text: string) => {
    setFind(text);
    const q = text.trim().toLowerCase();
    const n = graph.nodes.find((x) => x.title.toLowerCase() === q || x.slug === q);
    if (n) {
      setSelected(n.id);
      setFocus({ id: n.id, n: (focus?.n ?? 0) + 1 });
    }
  };
  const canvas = {
    shape,
    style,
    faintLinks,
    colors,
    width: size.width,
    height: size.height,
    selected: selected ?? current?.id,
    hover,
    near,
    labels,
    paused: paused || hidden,
    reduced,
    fit,
    focus,
    onHover: setHover,
    onSelect: setSelected,
    onOpen: open,
  };

  if (data.nodes.length === 0)
    return <Empty>Nothing to draw yet. Items and the links between them show up here.</Empty>;
  return (
    <section aria-label="Memory graph" className="space-y-3">
      {controls && (
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Dimensions" className="flex gap-1">
            <button
              type="button"
              aria-pressed={flat}
              className={pill(flat)}
              onClick={() => setDim?.("2d")}
            >
              2D
            </button>
            <button
              type="button"
              aria-pressed={!flat}
              disabled={!webgl}
              title={webgl ? undefined : "This browser cannot draw 3D (WebGL is off)"}
              className={cn(pill(!flat), "disabled:opacity-50")}
              onClick={() => setDim?.("3d")}
            >
              3D
            </button>
          </div>
          <select
            aria-label="Color by"
            name="colorBy"
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as ColorBy)}
            className={cn(control, "w-52")}
          >
            <option value="type">Color: who reads it</option>
            <option value="tag">Color: main tags</option>
          </select>
          <input
            type="search"
            aria-label="Find in the graph"
            name="find"
            list={`${id}-titles`}
            value={find}
            onChange={(e) => jump(e.currentTarget.value)}
            placeholder="Find in the graph…"
            className={cn(control, "w-52")}
          />
          <datalist id={`${id}-titles`}>
            {graph.nodes.slice(0, 500).map((n) => (
              <option key={n.id} value={n.title} />
            ))}
          </datalist>
          <Button variant="outline" onClick={() => setFit((f) => f + 1)}>
            Fit
          </Button>
          {flat && (
            <button
              type="button"
              aria-pressed={labels}
              className={pill(labels)}
              onClick={() => setLabels(!labels)}
            >
              Labels
            </button>
          )}
          <button
            type="button"
            aria-pressed={missing}
            className={pill(missing)}
            onClick={() => setMissing(!missing)}
          >
            Missing items
          </button>
          <button
            type="button"
            aria-pressed={paused}
            className={pill(paused)}
            onClick={() => setPaused(!paused)}
          >
            {paused ? "Paused" : "Pause"}
          </button>
        </div>
      )}
      <div
        ref={box}
        role="region"
        aria-label="Graph of memory items. Use Find in the graph to pick an item; double-click an item or press Enter to open it."
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Escape") setSelected(undefined);
          if (e.key === "Enter" && picked) open(picked);
        }}
        className={cn("relative w-full overflow-hidden rounded-lg border bg-background", height)}
      >
        {size.width > 0 && (
          <GraphBoundary
            fallback={
              <p role="alert" className="p-4 text-sm text-muted-foreground">
                The graph could not load. The list shows the same items.
              </p>
            }
          >
            <Suspense fallback={<Loading />}>
              {flat ? <Graph2D {...canvas} /> : <Graph3D {...canvas} />}
            </Suspense>
          </GraphBoundary>
        )}
        {hover && style.get(hover) && !picked && (
          <p className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] rounded-md border bg-card px-2 py-1 text-xs break-words">
            {style.get(hover)!.title}
          </p>
        )}
        {picked && (
          <GraphPreview
            node={picked}
            data={byId.get(picked.id)}
            onClose={() => setSelected(undefined)}
            onCreate={(slug) => void navigate({ to: "/memory", search: { create: slug } as never })}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {controls ? (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Colors">
            {graph.legend.map((l) => (
              <li key={l.group} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: colors.group(l.group) }}
                />
                {l.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <p aria-live="polite">
          {summary(graph, data.truncated)}. Bigger means more important or more linked. Faint means
          it does not match the filters.
        </p>
      </div>
    </section>
  );
}

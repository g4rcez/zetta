import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { Loading } from "../shared/ui";
import { wikiQueries } from "./wiki-api";
import { fromNeighbors } from "./wiki-graph";
import { useSeen } from "./use-size";

const GraphView = lazy(() => import("./graph-view").then((m) => ({ default: m.GraphView })));
const MAX_NODES = 30;

/** The items around one item, one or two links away. It loads when scrolled into view, so a page you only read never pulls the drawing library. */
export function MiniGraph({ slug, title }: { slug: string; title: string }) {
  const [box, seen] = useSeen<HTMLElement>();
  const [depth, setDepth] = useState<1 | 2>(1);
  const neighbors = useQuery({ ...wikiQueries.neighbors(slug, depth), enabled: seen });
  const r = neighbors.data;
  const error = neighbors.isError ? errorMessage(neighbors.error) : undefined;
  const data = useMemo(() => {
    if (!r) return undefined;
    const nodes = r.nodes.slice(0, MAX_NODES - 1);
    const keep = new Set([slug, ...nodes.map((n) => n.slug)]);
    return fromNeighbors({
      slug,
      title,
      nodes,
      edges: r.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    });
  }, [r, slug, title]);
  return (
    <section ref={box} aria-labelledby="wiki-mini-graph" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="wiki-mini-graph" className="text-sm font-medium">
          Around this item
        </h2>
        <div role="group" aria-label="How far to look" className="flex gap-1 text-xs">
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={depth === d}
              onClick={() => setDepth(d)}
              className={`rounded-full px-2 py-0.5 font-medium focus-visible:outline-2 focus-visible:outline-ring ${depth === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {d === 1 ? "1 link" : "2 links"}
            </button>
          ))}
        </div>
      </div>
      {!seen || (!r && !error) ? (
        <Loading />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : data ? (
        <Suspense fallback={<Loading />}>
          <GraphView data={data} dim="2d" focusSlug={slug} height="h-64" controls={false} />
        </Suspense>
      ) : null}
    </section>
  );
}

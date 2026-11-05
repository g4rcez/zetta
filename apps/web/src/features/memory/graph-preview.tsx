import { Link } from "@tanstack/react-router";
import { XIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { Badge } from "../shared/ui";
import { TYPE } from "./memory-api";
import type { GNode, GraphNodeData } from "./memory-graph";

/** What the person picked in the graph: the title, who reads it and the way to its page. */
export function GraphPreview({
  node,
  data,
  onClose,
  onCreate,
}: {
  node: GNode;
  data: GraphNodeData | undefined;
  onClose: () => void;
  onCreate: (slug: string) => void;
}) {
  return (
    <aside
      aria-label="Selected item"
      className="absolute top-3 right-3 z-10 w-64 max-w-[calc(100%-1.5rem)] space-y-2 rounded-lg border bg-card p-3 text-sm shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-medium break-words">{node.title}</h3>
        <Button size="xs" variant="ghost" aria-label="Close the preview" onClick={onClose}>
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {node.missing || !data ? (
        <>
          <p className="text-muted-foreground">
            Some item links to [[{node.slug}]], but no item has that name yet.
          </p>
          <Button size="sm" onClick={() => onCreate(node.slug)}>
            Create it
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{TYPE[data.type]}</Badge>
            <span className="text-xs text-muted-foreground">
              score {data.score} / 100 · {data.inDegree + data.outDegree}{" "}
              {data.inDegree + data.outDegree === 1 ? "link" : "links"}
            </span>
          </div>
          {data.tags.length > 0 && (
            <p className="text-xs break-words text-muted-foreground">{data.tags.join(", ")}</p>
          )}
          <Link
            to="/memory/$slug"
            params={{ slug: data.slug }}
            className="inline-block font-medium underline"
          >
            Open item
          </Link>
        </>
      )}
    </aside>
  );
}

import type { GraphColors } from "./graph-colors";
import type { GLink, GNode } from "./memory-graph";

/** What the 2D and 3D canvases get. `shape` is the drawing library's own copy of the nodes and links (it moves them); everything else only styles it. */
export type CanvasProps = {
  shape: { nodes: GNode[]; links: GLink[] };
  /** The current style of each node by id (filters, search hits). */
  style: ReadonlyMap<string, GNode>;
  /** Links whose end does not match the filters. */
  faintLinks: ReadonlySet<string>;
  colors: GraphColors;
  width: number;
  height: number;
  selected: string | undefined;
  /** The hovered node and the ones around it; the rest fade. */
  hover: string | undefined;
  near: ReadonlySet<string> | undefined;
  labels: boolean;
  paused: boolean;
  reduced: boolean;
  /** Counters: a change asks the canvas to fit everything in view, or to move to a node. */
  fit: number;
  focus: { id: string; n: number } | undefined;
  onHover: (id: string | undefined) => void;
  onSelect: (id: string | undefined) => void;
  onOpen: (node: GNode) => void;
};

export const endId = (end: unknown) =>
  typeof end === "object" && end ? String((end as { id: unknown }).id) : String(end);
export const linkKey = (l: { source?: unknown; target?: unknown; relation?: unknown }) =>
  `${endId(l.source)}|${endId(l.target)}|${String(l.relation)}`;

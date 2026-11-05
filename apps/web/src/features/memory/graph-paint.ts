import type { GraphColors } from "./graph-colors";
import type { GNode } from "./memory-graph";

type Placed = GNode & { x?: number; y?: number };
const TAU = Math.PI * 2;

/**
 * Draws one node on the 2D canvas: a disc in the color of its group, faint when it does not match the filters or is far from the hovered
 * node, ringed when it is a search result or the selected item. The title shows for hovered, selected and found nodes, and for all of
 * them once the view is zoomed in and labels are on.
 */
export function paintNode(
  n: Placed,
  ctx: CanvasRenderingContext2D,
  scale: number,
  c: GraphColors,
  o: {
    faint: boolean;
    selected: boolean;
    hovered: boolean;
    current?: boolean;
    labels: boolean;
  },
) {
  const x = n.x ?? 0,
    y = n.y ?? 0,
    r = n.size;
  ctx.save();
  ctx.globalAlpha = o.faint ? 0.12 : n.dim ? 0.28 : 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = n.missing ? c.background : c.group(n.group);
  ctx.fill();
  if (n.missing) {
    ctx.setLineDash([2 / scale, 2 / scale]);
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1 / scale;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (n.hit || o.selected || o.current) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2 / scale, 0, TAU);
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = n.hit ? c.hit : c.text;
    ctx.stroke();
  }
  if (o.hovered || o.selected || o.current || n.hit || (o.labels && scale > 3.2)) {
    ctx.font = `${11 / scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = c.text;
    ctx.fillText(n.title.length > 40 ? `${n.title.slice(0, 39)}…` : n.title, x, y + r + 3 / scale);
  }
  ctx.restore();
}

/** The area that reacts to the pointer is a little larger than the disc, so small nodes can be hit. */
export function paintPointerArea(n: Placed, color: string, ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(n.x ?? 0, n.y ?? 0, n.size + 2, 0, TAU);
  ctx.fill();
}

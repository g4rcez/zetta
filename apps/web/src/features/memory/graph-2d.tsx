import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useEffect, useRef } from "react";

import { withAlpha } from "./graph-colors";
import { paintNode, paintPointerArea } from "./graph-paint";
import { endId, linkKey, type CanvasProps } from "./graph-types";
import { RELATION_STYLE, type GLink, type GNode } from "./memory-graph";

const MANY_LINKS = 1500; // above this the arrows are left out: they cost more than they tell

/** The flat graph, drawn on a canvas by react-force-graph. */
export default function Graph2D(p: CanvasProps) {
  const ref = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const arrows = p.shape.links.length <= MANY_LINKS;
  const ms = p.reduced ? 0 : 400;
  // Items linked to nothing are only pushed away by the others: a short reach keeps them near the rest instead of far out, where they shrink the view.
  useEffect(() => {
    (
      ref.current?.d3Force("charge") as { distanceMax?: (d: number) => void } | undefined
    )?.distanceMax?.(120);
  }, [p.shape]);
  // The layout starts around the origin, off the middle of the canvas. It is fitted into view on the first tick after the warm-up (so
  // there is no visible jump, even with 2,000 items) and again, animated, when it stops moving.
  const fitted = useRef(false);
  const ticked = useRef(false);
  useEffect(() => {
    fitted.current = false;
    ticked.current = false;
  }, [p.shape, p.width, p.height]);
  useEffect(() => {
    if (p.paused) ref.current?.pauseAnimation();
    else ref.current?.resumeAnimation();
  }, [p.paused]);
  useEffect(() => {
    if (p.fit) ref.current?.zoomToFit(ms, 40);
  }, [p.fit]);
  useEffect(() => {
    const n =
      p.focus &&
      (p.shape.nodes.find((x) => x.id === p.focus!.id) as GNode & { x?: number; y?: number });
    if (n?.x === undefined || n.y === undefined) return;
    ref.current?.centerAt(n.x, n.y, ms);
    ref.current?.zoom(3, ms);
  }, [p.focus]);
  const faded = (id: string) => Boolean(p.near && !p.near.has(id));
  return (
    <ForceGraph2D<GNode, GLink>
      ref={ref}
      width={p.width}
      height={p.height}
      graphData={p.shape}
      nodeId="id"
      // The title is drawn on the canvas as text; the library's own label is HTML and must never carry user text.
      nodeLabel={() => ""}
      backgroundColor={p.colors.background}
      warmupTicks={100}
      cooldownTicks={p.reduced ? 0 : 200}
      cooldownTime={4000}
      d3AlphaDecay={0.03}
      nodeCanvasObject={(node, ctx, scale) => {
        const s = p.style.get(node.id as string) ?? node;
        paintNode({ ...s, x: node.x, y: node.y }, ctx, scale, p.colors, {
          faint: faded(node.id as string),
          selected: p.selected === node.id,
          hovered: p.hover === node.id,
          labels: p.labels,
        });
      }}
      nodePointerAreaPaint={(node, color, ctx) => paintPointerArea(node, color, ctx)}
      linkColor={(l) =>
        p.faintLinks.has(linkKey(l)) || faded(endId(l.source)) || faded(endId(l.target))
          ? withAlpha(p.colors.muted, 0.12)
          : withAlpha(p.colors.muted, 0.6)
      }
      linkWidth={1}
      linkLineDash={(l) => RELATION_STYLE[l.relation as GLink["relation"]]?.dash ?? null}
      linkDirectionalArrowLength={(l) =>
        arrows && RELATION_STYLE[l.relation as GLink["relation"]]?.arrow ? 4 : 0
      }
      linkDirectionalArrowRelPos={1}
      onNodeHover={(n) => p.onHover(n ? (n.id as string) : undefined)}
      onNodeClick={(n, e) => {
        p.onSelect(n.id as string);
        if (e.detail === 2) p.onOpen(p.style.get(n.id as string) ?? n);
      }}
      onEngineTick={() => {
        if (ticked.current) return;
        ticked.current = true;
        ref.current?.zoomToFit(0, 40);
      }}
      onEngineStop={() => {
        if (fitted.current) return;
        fitted.current = true;
        ref.current?.zoomToFit(ms, 40);
      }}
      onBackgroundClick={() => p.onSelect(undefined)}
    />
  );
}

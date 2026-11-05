import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import { useEffect, useRef } from "react";

import { withAlpha } from "./graph-colors";
import { endId, linkKey, type CanvasProps } from "./graph-types";
import { RELATION_STYLE, type GLink, type GNode } from "./memory-graph";

const MANY_LINKS = 1500;

/** The same graph in space (WebGL, drag to turn it). Loaded only when the person asks for 3D, because three.js is large. */
export default function Graph3D(p: CanvasProps) {
  const ref = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const arrows = p.shape.links.length <= MANY_LINKS;
  const ms = p.reduced ? 0 : 600;
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
    if (p.fit) ref.current?.zoomToFit(ms, 60);
  }, [p.fit]);
  useEffect(() => {
    const n =
      p.focus &&
      (p.shape.nodes.find((x) => x.id === p.focus!.id) as
        | (GNode & { x?: number; y?: number; z?: number })
        | undefined);
    if (n?.x === undefined || n.y === undefined || n.z === undefined) return;
    const d = 1 + 80 / Math.max(1, Math.hypot(n.x, n.y, n.z));
    ref.current?.cameraPosition(
      { x: n.x * d, y: n.y * d, z: n.z * d },
      { x: n.x, y: n.y, z: n.z },
      ms,
    );
  }, [p.focus]);
  const faded = (id: string) => Boolean(p.near && !p.near.has(id));
  return (
    <ForceGraph3D<GNode, GLink>
      ref={ref}
      width={p.width}
      height={p.height}
      graphData={p.shape}
      nodeId="id"
      // See graph-2d: no HTML label from user text.
      nodeLabel={() => ""}
      backgroundColor={p.colors.background}
      showNavInfo={false}
      nodeResolution={6}
      nodeOpacity={0.95}
      nodeVal={(n) => Math.max(1, (p.style.get(n.id as string)?.size ?? 3) ** 1.5 / 2)}
      nodeColor={(n) => {
        const s = p.style.get(n.id as string);
        return !s || s.dim || faded(n.id as string) ? p.colors.muted : p.colors.group(s.group);
      }}
      linkColor={(l) =>
        p.faintLinks.has(linkKey(l)) || faded(endId(l.source)) || faded(endId(l.target))
          ? withAlpha(p.colors.muted, 0.15)
          : withAlpha(p.colors.muted, 0.7)
      }
      linkOpacity={0.6}
      linkWidth={0}
      linkDirectionalArrowLength={(l) =>
        arrows && RELATION_STYLE[l.relation as GLink["relation"]]?.arrow ? 3 : 0
      }
      linkDirectionalArrowRelPos={1}
      warmupTicks={80}
      cooldownTicks={p.reduced ? 0 : 150}
      d3AlphaDecay={0.03}
      onNodeHover={(n) => p.onHover(n ? (n.id as string) : undefined)}
      onNodeClick={(n, e) => {
        p.onSelect(n.id as string);
        if (e.detail === 2) p.onOpen(p.style.get(n.id as string) ?? n);
      }}
      onEngineTick={() => {
        if (ticked.current) return;
        ticked.current = true;
        ref.current?.zoomToFit(0, 60);
      }}
      onEngineStop={() => {
        if (fitted.current) return;
        fitted.current = true;
        ref.current?.zoomToFit(ms, 60);
      }}
      onBackgroundClick={() => p.onSelect(undefined)}
    />
  );
}

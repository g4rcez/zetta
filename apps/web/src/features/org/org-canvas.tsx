import "@xyflow/react/dist/style.css";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { CaretDownIcon, CaretRightIcon, WarningIcon } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { IconHint } from "@/components/icon-hint";
import { cn } from "@zetta/ui/lib/utils";
import { useTheme } from "../../components/theme-provider";
import type { OrgLink, OrgPosition } from "./org-api";
import { linkEdges, type WorksEdge } from "./org-links";
import { RankMark, SeatHolder, problemText } from "./org-bits";
import { SEAT_SIZE, toFlow, type SeatNode } from "./org-graph";
import type { OrgFilterState } from "./org-search";

/** React Flow draws the seats itself, so the page hands what a seat needs through context. */
const SeatContext = createContext<{ selectedId: string; toggle: (id: string) => void }>({
  selectedId: "",
  toggle: () => {},
});

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function SeatCard({ data }: NodeProps<SeatNode>) {
  const { selectedId, toggle } = useContext(SeatContext);
  const { item, reports, collapsed, match } = data;
  const selected = selectedId === item.id;
  const lead = [item.unit, item.team ? `Leads ${item.team.name}` : ""].filter(Boolean).join(" · ");
  return (
    <div
      style={{ width: SEAT_SIZE.w, height: SEAT_SIZE.h }}
      className={cn(
        "flex flex-col justify-between rounded-lg border bg-card px-3 py-2 shadow-sm",
        item.rank === "ceo" && "border-warn",
        match === "no" && "opacity-40",
        match === "yes" && "ring-2 ring-primary/60",
        selected && "border-primary ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" isConnectable={false} />
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.title}</p>
          <p className="truncate text-xs text-muted-foreground">{lead || " "}</p>
        </div>
        <RankMark rank={item.rank} />
        {item.problem && (
          <IconHint label={problemText(item.problem)}>
            <WarningIcon className="size-4 shrink-0 text-warn" />
          </IconHint>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <SeatHolder item={item} size={24} className="flex-1" />
        {reports > 0 && (
          // No hint: it shows how many seats report here.
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Show" : "Hide"} the ${reports} under ${item.title}`}
            onClick={(e) => {
              stop(e);
              toggle(item.id);
            }}
            className="nodrag nopan flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs tabular-nums hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {collapsed ? (
              <CaretRightIcon aria-hidden="true" className="size-3" />
            ) : (
              <CaretDownIcon aria-hidden="true" className="size-3" />
            )}
            {reports}
          </button>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="opacity-0"
        isConnectable={false}
      />
      {/* The sides are where the dotted "works with" lines meet a seat; the reporting lines use the top and the bottom. */}
      <Handle
        id="l-in"
        type="target"
        position={Position.Left}
        className="opacity-0"
        isConnectable={false}
      />
      <Handle
        id="r-in"
        type="target"
        position={Position.Right}
        className="opacity-0"
        isConnectable={false}
      />
      <Handle
        id="r-out"
        type="source"
        position={Position.Right}
        className="opacity-0"
        isConnectable={false}
      />
    </div>
  );
}
const nodeTypes = { seat: SeatCard };

/** A dotted line between two bots that work together. The more they share, the thicker it is. */
function WorksLine({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<WorksEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const weight = data?.link.weight ?? 1;
  return (
    <BaseEdge
      id={id}
      path={path}
      interactionWidth={20}
      style={{
        stroke: "var(--color-primary, currentColor)",
        strokeDasharray: "2 6",
        strokeLinecap: "round",
        strokeWidth: (selected ? 2 : 1) + Math.min(weight, 4) * 0.6,
      }}
    />
  );
}
const edgeTypes = { works: WorksLine };

/** What the dotted lines mean, and the reason for the one the reader points at or selects. */
function WorksLegend({
  links,
  detail,
  error,
}: {
  links: readonly OrgLink[] | undefined;
  detail: WorksEdge["data"] | undefined;
  error: string | undefined;
}) {
  return (
    <div
      role="status"
      className="max-w-72 space-y-1 rounded-lg border bg-card/95 p-3 text-xs shadow-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <svg aria-hidden="true" width="28" height="6" className="shrink-0 text-primary">
          <line
            x1="1"
            y1="3"
            x2="27"
            y2="3"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="2 5"
            strokeLinecap="round"
          />
        </svg>
        Bots that work together
      </p>
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : !links ? (
        <p className="text-muted-foreground">Looking at rooms, workflows and handoffs…</p>
      ) : detail ? (
        <p>
          <span className="font-medium">
            {detail.names[0]} and {detail.names[1]}
          </span>
          : {detail.sentence}
        </p>
      ) : links.length === 0 ? (
        <p className="text-muted-foreground">
          No two bots of the chart work together yet. Shared rooms, workflow steps and decision
          handoffs show up here.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Point at a line, or select it with the keyboard, to see why the two bots are joined.
        </p>
      )}
    </div>
  );
}

type CanvasProps = {
  positions: readonly OrgPosition[];
  filters: Pick<OrgFilterState, "q" | "show">;
  collapsed: ReadonlySet<string>;
  /** The selected seat, from the address: it is marked, and brought into view when it is out of sight. */
  selectedId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  /** The works-with layer: dotted lines are drawn when `showLinks` is on. `links` is undefined while they load. */
  showLinks?: boolean;
  links?: readonly OrgLink[] | undefined;
  linksError?: string | undefined;
};

/** How far from the edge of the canvas a seat has to be to count as in sight. */
const EDGE = 24;

function Flow({
  positions,
  filters,
  collapsed,
  selectedId,
  onSelect,
  onToggle,
  showLinks = false,
  links,
  linksError,
}: CanvasProps) {
  const { resolvedTheme } = useTheme();
  const [detail, setDetail] = useState<WorksEdge["data"]>();
  const rf = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const size = useRef({ width, height });
  size.current = { width, height };
  const flow = useMemo(
    () => toFlow(positions, { collapsed, filters }),
    [positions, collapsed, filters],
  );
  // The dotted lines follow the seats the canvas shows. A line takes the keyboard focus, and then says why its two bots are joined.
  const edges = useMemo((): Edge[] => {
    if (!showLinks || !links) return flow.edges;
    const works = linkEdges(links, flow.nodes).map((e) => ({
      ...e,
      domAttributes: { onFocus: () => setDetail(e.data), onBlur: () => setDetail(undefined) },
    }));
    return [...flow.edges, ...works];
  }, [flow, links, showLinks]);
  useEffect(() => {
    if (!showLinks) setDetail(undefined);
  }, [showLinks]);
  const [nodes, setNodes, onNodesChange] = useNodesState<SeatNode>(flow.nodes);
  // The layout is a function of the chart: the server's answer moves a seat for real.
  useEffect(() => setNodes(flow.nodes), [flow.nodes, setNodes]);
  const shape = flow.nodes.map((n) => n.id).join(",");
  // The selection the first view already looked at, so the effect below does not move the view a second time.
  const framed = useRef("");
  useEffect(() => {
    framed.current = selectedId;
    const frame = requestAnimationFrame(() => {
      // The first view is the leadership: the CEO and the seats that report to it, at a size that can be read. A wide chart is panned (or
      // moved with the minimap). A seat named in the address is brought into view instead.
      const root = positions.find((p) => p.parentId === null);
      const top = flow.nodes.filter((n) => n.id === root?.id || n.data.item.parentId === root?.id);
      const aim =
        selectedId && flow.nodes.some((n) => n.id === selectedId)
          ? [selectedId]
          : top.map((n) => n.id);
      void rf.fitView({
        padding: 0.15,
        minZoom: 0.55,
        maxZoom: 1.1,
        duration: 250,
        ...(aim.length && { nodes: aim.map((id) => ({ id })) }),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  // Choosing a seat (a click, a search, a link) moves the view only when the seat is out of sight, so a click never shifts the chart.
  useEffect(() => {
    if (!selectedId || framed.current === selectedId) return;
    framed.current = selectedId;
    // The panel that opens beside the chart narrows it a moment later: look once it has.
    const timer = window.setTimeout(() => {
      const node = flow.nodes.find((n) => n.id === selectedId);
      if (!node) return;
      const v = rf.getViewport();
      const left = node.position.x * v.zoom + v.x;
      const top = node.position.y * v.zoom + v.y;
      const inSight =
        left >= EDGE &&
        top >= EDGE &&
        left + SEAT_SIZE.w * v.zoom <= size.current.width - EDGE &&
        top + SEAT_SIZE.h * v.zoom <= size.current.height - EDGE;
      if (!inSight)
        void rf.setCenter(node.position.x + SEAT_SIZE.w / 2, node.position.y + SEAT_SIZE.h / 2, {
          zoom: Math.min(Math.max(v.zoom, 0.7), 1.1),
          duration: 250,
        });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const context = useMemo(() => ({ selectedId, toggle: onToggle }), [selectedId, onToggle]);
  return (
    <SeatContext.Provider value={context}>
      <div
        className="h-full min-h-72"
        role="application"
        aria-label="Organization chart. Select a seat to see and change it."
      >
        <ReactFlow
          colorMode={resolvedTheme === "light" ? "light" : "dark"}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onEdgeMouseEnter={(_, e) => e.type === "works" && setDetail(e.data as WorksEdge["data"])}
          onEdgeMouseLeave={() => setDetail(undefined)}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => onSelect(n.id)}
          // A scroll or a drag pans, a pinch or Ctrl+scroll zooms; a seat never moves under the pointer, because it is moved from its panel.
          panOnScroll
          panOnDrag
          zoomOnScroll={false}
          zoomOnPinch
          nodesDraggable={false}
          nodesConnectable={false}
          deleteKeyCode={null}
          minZoom={0.15}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="Overview of the chart" />
          {showLinks && (
            <Panel position="top-left">
              <WorksLegend links={links} detail={detail} error={linksError} />
            </Panel>
          )}
        </ReactFlow>
      </div>
    </SeatContext.Provider>
  );
}

/** The chart as a tree on a canvas: scroll to pan, pinch to zoom, fold a branch, and select a seat to change it in its panel. */
export function OrgCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

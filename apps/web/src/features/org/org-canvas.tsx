import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { CaretDownIcon, CaretRightIcon, WarningIcon } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useMemo, type DragEvent } from "react";

import { IconHint } from "@/components/icon-hint";
import { toast } from "@/lib/notify";
import { cn } from "@zetta/ui/lib/utils";
import { useTheme } from "../../components/theme-provider";
import type { OrgPosition } from "./org-api";
import { RankMark, SeatHolder, problemText } from "./org-bits";
import { SEAT_SIZE, dropMove, seatAt, toFlow, type SeatNode } from "./org-graph";
import { readDragItem, type OrgDragItem } from "./org-palette";
import type { OrgFilterState } from "./org-search";
import { SeatMenu, type SeatActions } from "./seat-menu";

/** React Flow draws the seats itself, so the page hands what a seat needs through context. */
const SeatContext = createContext<{
  positions: readonly OrgPosition[];
  actions: SeatActions;
  toggle: (id: string) => void;
}>({
  positions: [],
  actions: {
    open: () => {},
    addReport: () => {},
    shift: () => {},
    empty: () => {},
    remove: () => {},
  },
  toggle: () => {},
});

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function SeatCard({ data, selected }: NodeProps<SeatNode>) {
  const { positions, actions, toggle } = useContext(SeatContext);
  const { item, reports, collapsed, match, canEdit } = data;
  const lead = [item.unit, item.team ? `Leads ${item.team.name}` : ""].filter(Boolean).join(" · ");
  return (
    <div
      style={{ width: SEAT_SIZE.w, height: SEAT_SIZE.h }}
      className={cn(
        "flex flex-col justify-between rounded-lg border bg-card px-3 py-2 shadow-sm",
        item.rank === "ceo" && "border-warn",
        match === "no" && "opacity-40",
        match === "yes" && "ring-2 ring-primary",
        selected && "ring-2 ring-ring",
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
        {canEdit && (
          <span className="nodrag nopan" onClick={stop}>
            <SeatMenu item={item} positions={positions} actions={actions} />
          </span>
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
    </div>
  );
}
const nodeTypes = { seat: SeatCard };

type CanvasProps = {
  positions: readonly OrgPosition[];
  canEdit: boolean;
  filters: Pick<OrgFilterState, "q" | "show">;
  collapsed: ReadonlySet<string>;
  /** A seat to bring into view, from the address. */
  focus: string;
  actions: SeatActions;
  onToggle: (id: string) => void;
  /** A seat was dropped on another one: it reports to it now. */
  onMoveSeat: (id: string, parentId: string) => void;
  /** Something from the palette was dropped on a seat. */
  onDropItem: (item: OrgDragItem, seatId: string) => void;
};

function Flow({
  positions,
  canEdit,
  filters,
  collapsed,
  focus,
  actions,
  onToggle,
  onMoveSeat,
  onDropItem,
}: CanvasProps) {
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow();
  const flow = useMemo(
    () => toFlow(positions, { collapsed, filters, canEdit }),
    [positions, collapsed, filters, canEdit],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<SeatNode>(flow.nodes);
  // The layout is a function of the chart: a seat that was dragged goes back to its place, and the server's answer moves it for real.
  useEffect(() => setNodes(flow.nodes), [flow.nodes, setNodes]);
  const shape = flow.nodes.map((n) => n.id).join(",");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      // The first view is the leadership: the CEO and the seats that report to it, at a size that can be read. A wide chart is panned (or
      // moved with the minimap). A seat named in the address is brought into view instead.
      const root = positions.find((p) => p.parentId === null);
      const top = flow.nodes.filter((n) => n.id === root?.id || n.data.item.parentId === root?.id);
      const aim = focus && flow.nodes.some((n) => n.id === focus) ? [focus] : top.map((n) => n.id);
      void rf.fitView({
        padding: 0.15,
        minZoom: 0.55,
        maxZoom: 1.1,
        duration: 250,
        ...(aim.length && { nodes: aim.map((id) => ({ id })) }),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [shape, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const context = useMemo(
    () => ({ positions, actions, toggle: onToggle }),
    [positions, actions, onToggle],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const item = readDragItem(e);
    if (!item) return;
    const target = seatAt(flow.nodes, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    if (!target) return void toast("Drop it on a seat.");
    onDropItem(item, target);
  };
  return (
    <SeatContext.Provider value={context}>
      <div
        className="h-full min-h-72"
        role="application"
        aria-label="Organization chart. Open a seat to see and change it."
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={canEdit ? onDrop : undefined}
      >
        <ReactFlow
          colorMode={resolvedTheme === "light" ? "light" : "dark"}
          nodes={nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => actions.open(n.id)}
          onNodeDragStop={(_, n) => {
            const center = {
              x: n.position.x + SEAT_SIZE.w / 2,
              y: n.position.y + SEAT_SIZE.h / 2,
            };
            const target = seatAt(flow.nodes, center, n.id);
            const result = target ? dropMove(positions, n.id, target) : ({ kind: "noop" } as const);
            if (result.kind === "refused") toast.error(result.message);
            if (result.kind === "move") onMoveSeat(n.id, result.parentId);
            setNodes(flow.nodes);
          }}
          nodesDraggable={canEdit}
          nodesConnectable={false}
          deleteKeyCode={null}
          minZoom={0.15}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="Overview of the chart" />
        </ReactFlow>
      </div>
    </SeatContext.Provider>
  );
}

/** The chart as a tree on a canvas: pan and zoom, fold a branch, and (for the admin) drag a seat onto another to change who it reports to. */
export function OrgCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

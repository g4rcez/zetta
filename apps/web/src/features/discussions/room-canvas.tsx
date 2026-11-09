import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type NodeProps,
} from "@xyflow/react";
import { CrownIcon } from "@phosphor-icons/react";
import { useMemo } from "react";

import { cn } from "@zetta/ui/lib/utils";
import { BotIdentity, BotsContext, useBotIdentity } from "@/components/bot-identity";
import type { Bot } from "../chat/chat-client";
import { useTheme } from "../../components/theme-provider";
import type { DiscussionMember, RoomTask, RoomTurn } from "./discussions-api";
import { NODE_W, roomToFlow, type MemberNode, type MemberState } from "./room-graph";
import { IconHint } from "@/components/icon-hint";

const STATE_LABEL: Record<MemberState, string> = {
  idle: "Idle",
  queued: "Waiting",
  running: "Working",
  done: "Done",
  failed: "Failed",
};
const STATE_CLASS: Record<MemberState, string> = {
  idle: "bg-muted text-muted-foreground",
  queued: "bg-warn/15 text-warn",
  running: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};
const TASK_LABEL = {
  backlog: "backlog",
  in_progress: "in progress",
  blocked: "blocked",
  review: "review",
  done: "done",
} as const;

function MemberCard({ data, selected }: NodeProps<MemberNode>) {
  const bot = useBotIdentity(data.botId, data.name);
  const counts = Object.entries(data.tasks.counts) as [keyof typeof TASK_LABEL, number][];
  return (
    <div
      style={{ width: NODE_W }}
      className={cn(
        "space-y-1.5 rounded-lg border bg-card p-3 text-xs shadow",
        data.kind === "chief" && "border-warn",
        selected && "ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="opacity-0" />
      <BotIdentity
        bot={bot}
        sub={data.role || (data.kind === "chief" ? "Chief" : "Member")}
        trailing={
          <>
            {data.kind === "chief" && (
              <IconHint label="Chief">
                <CrownIcon className="size-3.5 shrink-0 text-warn" />
              </IconHint>
            )}
            <span
              className={cn("shrink-0 rounded px-1.5 py-0.5 font-medium", STATE_CLASS[data.state])}
            >
              {STATE_LABEL[data.state]}
            </span>
          </>
        }
      />
      {data.lastStep && <p className="truncate italic">{data.lastStep}</p>}
      <div className="border-t pt-1.5">
        <p className="font-medium text-muted-foreground">Tasks</p>
        {counts.length === 0 ? (
          <p className="text-muted-foreground">None yet</p>
        ) : (
          <>
            <p>{counts.map(([s, n]) => `${n} ${TASK_LABEL[s]}`).join(" · ")}</p>
            <ul className="list-disc pl-4 text-muted-foreground">
              {data.tasks.open.map((t) => (
                <li key={t} className="truncate">
                  {t}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="opacity-0"
      />
    </div>
  );
}
const nodeTypes = { member: MemberCard };

/** Read-only view of a team room: the chief on top, members below, each card showing state, latest step and task report. */
export function RoomCanvas({
  bots,
  members,
  chiefId,
  turns,
  tasks,
  onOpen,
}: {
  bots: Bot[];
  members: DiscussionMember[];
  chiefId: string | null;
  turns: RoomTurn[];
  tasks: RoomTask[];
  onOpen: (botId: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const flow = useMemo(
    () => roomToFlow(members, chiefId, turns, tasks),
    [members, chiefId, turns, tasks],
  );
  return (
    <div
      className="min-h-0 flex-1"
      role="application"
      aria-label="Room canvas. Select a bot to see its steps."
    >
      <BotsContext.Provider value={botsById}>
        <ReactFlowProvider>
          <ReactFlow
            colorMode={resolvedTheme === "light" ? "light" : "dark"}
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, n) => onOpen(n.id)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </BotsContext.Provider>
    </div>
  );
}

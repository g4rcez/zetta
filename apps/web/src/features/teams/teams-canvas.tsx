import { ActionHint } from "@/components/action-hint";
import { mentionsAsText } from "@zetta/core/mentions";
import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { Link as RouterLink, useNavigate } from "@tanstack/react-router";
import { CrownIcon, PlusIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import { Tooltip } from "@g4rcez/components/tooltip";
import { cn } from "@zetta/ui/lib/utils";
import { BotIdentity, BotsContext, useBotIdentity } from "@/components/bot-identity";
import { Button } from "@/components/ui";
import { useSidebarData } from "../chat/sidebar-data";
import { useTheme } from "../../components/theme-provider";
import { errorMessage } from "../chat/chat-client";
import {
  addBot,
  arrange,
  BOT_SIZE,
  dropBot,
  dropTarget,
  flowToTeams,
  groupsOf,
  makeChief,
  TEAM_DEFAULT_SIZE,
  teamsToFlow,
  type BotNode,
  type TeamNode,
  type TeamsNode,
} from "./team-graph";
import { RolesContext, useRoleLabel, useTeamRoles } from "./team-roles";
import {
  TEAM_SIZE_WARNING,
  TEAM_SIZE_WARNING_AT,
  teamsApi,
  teamsQueries,
  type TeamSave,
} from "./teams-api";
import { IconHint } from "@/components/icon-hint";

/** What the server holds for a team, apart from its version. */
const saveKey = (v: TeamSave) => JSON.stringify({ ...v, expectedVersion: 0 });

const BOT_MIME = "application/x-zetta-bot";

/** Explains what a control does, with the design system tooltip. The wrapper takes hover and focus, so it also works on a disabled button. */
function Tip({
  tip,
  children,
  className,
}: {
  tip: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // The library's `title` is the element you hover; its children are the tooltip text.
    <Tooltip as="span" className={cn("inline-flex", className)} title={children}>
      {tip}
    </Tooltip>
  );
}

/** What the buttons in a team box title do; React Flow renders nodes itself, so the page hands them over through context. */
type Roster = { nodeId: string; name: string; chief: boolean }[];
const TeamActions = createContext<{
  configure: (nodeId: string) => void;
  /** The bots of a team box, by team node id. */
  roster: (teamNodeId: string) => Roster;
  /** Makes the bot with this node id the team lead. */
  setChief: (botNodeId: string) => void;
  /** Fits the bots to the group after a resize. */
  relayout: () => void;
}>({ configure: () => {}, roster: () => [], setChief: () => {}, relayout: () => {} });

function TeamGroup({ id, data, selected }: NodeProps<TeamNode>) {
  const actions = useContext(TeamActions);
  const roster = actions.roster(id);
  const lead = roster.find((m) => m.chief);
  return (
    <>
      <NodeResizer
        minWidth={260}
        minHeight={180}
        isVisible={selected}
        onResizeEnd={actions.relayout}
      />
      <div
        className={cn(
          "flex h-full w-full flex-col rounded-lg border-2 border-dashed bg-card/40",
          selected && "border-primary",
        )}
      >
        <div className="team-handle flex cursor-grab items-center gap-1 border-b py-1 pr-1.5 pl-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{data.name}</p>
          {roster.length > 0 && (
            <label className="nodrag flex min-w-0 shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <CrownIcon className="size-3.5 shrink-0 text-warn" aria-hidden="true" />
              <span className="sr-only">Team lead</span>
              <select
                value={lead?.nodeId ?? ""}
                onChange={(e) => actions.setChief(e.target.value)}
                className="max-w-32 cursor-pointer truncate rounded-md border bg-card py-0.5 pr-1 pl-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {roster.map((m) => (
                  <option key={m.nodeId} value={m.nodeId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <RouterLink
            to="/teams/$teamId"
            params={{ teamId: data.teamId }}
            className="nodrag shrink-0 text-xs underline hover:text-foreground"
          >
            Open
          </RouterLink>
          <Tip tip="Configure this team: name, goal and rooms" className="nodrag">
            <ActionHint label={`Configure ${data.name}`}>
              <Button
                variant="ghost"
                size="icon-sm"
                className="nodrag shrink-0"
                aria-label={`Configure ${data.name}`}
                onClick={() => actions.configure(id)}
              >
                <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
              </Button>
            </ActionHint>
          </Tip>
        </div>
        {/* Padding sits on the wrapper: on the clamped text it would show a sliver of the third line. */}
        {data.goal && (
          <div className="px-3 py-1">
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {mentionsAsText(data.goal)}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function BotCard({ data, selected }: NodeProps<BotNode>) {
  const bot = useBotIdentity(data.botId, data.name);
  const sub = useRoleLabel(data.roleId, data.kind === "chief");
  return (
    <div
      style={{ width: BOT_SIZE.w, height: BOT_SIZE.h }}
      className={cn(
        "flex items-center rounded-md border bg-card px-2 text-xs shadow",
        data.kind === "chief" && "border-warn",
        selected && "ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" isConnectable={false} />
      <BotIdentity
        bot={bot}
        size={28}
        sub={sub}
        trailing={
          data.kind === "chief" ? (
            <IconHint label="Lead">
              <CrownIcon className="size-3 shrink-0 text-warn" />
            </IconHint>
          ) : undefined
        }
      />
    </div>
  );
}
const nodeTypes = { team: TeamGroup, bot: BotCard };

function Editor() {
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { reloadTeams, bots: allBots } = useSidebarData();
  const [nodes, setNodes, onNodesChange] = useNodesState<TeamsNode>([]);
  const bots = useMemo(() => allBots.filter((x) => x.onboarded), [allBots]);
  const { roles } = useTeamRoles();
  const [busy, setBusy] = useState(false);
  const synced = useRef(new Map<string, { version: number; key: string }>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);
  const load = useCallback(async () => {
    try {
      // Always fresh: the nodes hold local edits, so a stale list would save an old version.
      const flow = teamsToFlow(await qc.fetchQuery({ ...teamsQueries.list(), staleTime: 0 }));
      synced.current = new Map(
        flowToTeams(flow).map((t) => [
          t.id,
          { version: t.save.expectedVersion, key: saveKey(t.save) },
        ]),
      );
      setNodes(arrange(flow));
    } catch (e) {
      fail(e);
    }
  }, [qc, setNodes, fail]);
  useEffect(() => {
    void load();
  }, [load]);

  async function work(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    }
    void reloadTeams();
    setBusy(false);
  }
  // Every change is saved as it happens: `sync` sends each team that differs from what the server holds. Saves run one at a time so each carries the version the last one returned.
  const sync = (ns: TeamsNode[]) =>
    (queue.current = queue.current.then(async () => {
      for (const t of flowToTeams(ns)) {
        const known = synced.current.get(t.id);
        if (!known || !t.save.name.trim() || known.key === saveKey(t.save)) continue;
        try {
          const team = await teamsApi.save(t.id, { ...t.save, expectedVersion: known.version });
          synced.current.set(t.id, { version: team.version, key: saveKey(t.save) });
          void reloadTeams();
        } catch (e) {
          fail(e);
          await load();
          return;
        }
      }
    }));
  useEffect(() => {
    const timer = setTimeout(() => void sync(nodes), 600);
    return () => clearTimeout(timer);
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  // Team settings are a page: a drawer is for a quick look, and this is configuration. The canvas saves first, so the page opens on what you see here.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const openSettings = async (nodeId: string) => {
    const current = nodesRef.current;
    const node = current.find((n) => n.id === nodeId);
    const team = node?.type === "team" ? node : current.find((n) => n.id === node?.parentId);
    if (team?.type !== "team") return;
    await sync(current);
    await navigate({
      to: "/teams/$teamId/settings",
      params: { teamId: team.data.teamId },
      search: {},
    });
  };
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;
  // A string key, so the title bars re-render when the roster changes but not on every drag.
  const rosterKey = JSON.stringify(
    nodes.flatMap((n) =>
      n.type === "bot" && n.parentId ? [[n.parentId, n.id, n.data.name, n.data.kind]] : [],
    ),
  );
  const actions = useMemo(() => {
    const byTeam = new Map<string, Roster>();
    for (const [team, nodeId, name, kind] of JSON.parse(rosterKey) as string[][])
      byTeam.set(team!, [
        ...(byTeam.get(team!) ?? []),
        { nodeId: nodeId!, name: name!, chief: kind === "chief" },
      ]);
    return {
      configure: (nodeId: string) => void openSettingsRef.current(nodeId),
      roster: (teamNodeId: string) => byTeam.get(teamNodeId) ?? [],
      setChief: (botNodeId: string) => setNodes((ns) => makeChief(ns, botNodeId)),
      relayout: () => setNodes(arrange),
    };
  }, [rosterKey, setNodes]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const bot = bots.find((b) => b.id === e.dataTransfer.getData(BOT_MIME));
    if (!bot) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const groups = groupsOf(nodes);
    const target = dropTarget(p, groups);
    if (!target) return void toast("Drop the bot inside a team.");
    const g = groups.find((x) => x.id === target)!;
    const next = addBot(
      nodes,
      target,
      { botId: bot.id, name: bot.name },
      { x: p.x - g.x - BOT_SIZE.w / 2, y: p.y - g.y - BOT_SIZE.h / 2 },
    );
    if (next === nodes) return void toast(`${bot.name} is already in this team.`);
    setNodes(next);
    if (next.filter((n) => n.parentId === target).length > TEAM_SIZE_WARNING_AT)
      toast.warning(TEAM_SIZE_WARNING);
  };

  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  return (
    <BotsContext.Provider value={botsById}>
      <RolesContext.Provider value={roles}>
        <TeamActions.Provider value={actions}>
          <div className="flex h-full min-h-0 flex-col md:flex-row">
            <aside
              aria-label="Bots"
              className="max-h-40 shrink-0 overflow-y-auto border-b p-3 md:max-h-none md:w-56 md:border-r md:border-b-0"
            >
              <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Bots</h2>
              <p className="mb-2 text-xs text-muted-foreground">
                Drag a bot into a team. Drag it out of the team to remove it.
              </p>
              <ul className="space-y-1">
                {bots.map((b) => (
                  <li
                    key={b.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(BOT_MIME, b.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="cursor-grab rounded-lg border bg-card px-2 py-1.5"
                  >
                    <Tip tip="Drag this bot into a team box" className="w-full min-w-0">
                      <BotIdentity bot={b} sub={b.description || b.harness} className="w-full" />
                    </Tip>
                  </li>
                ))}
                {bots.length === 0 && (
                  <li className="text-xs text-muted-foreground">No ready bots yet.</li>
                )}
              </ul>
            </aside>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
                <h1 className="mr-auto text-base font-semibold">Teams</h1>
                <Tip tip="Add an empty team box to the canvas">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        const k = groupsOf(nodes).length;
                        await teamsApi.create(`Team ${k + 1}`, {
                          x: 40 + (k % 2) * (TEAM_DEFAULT_SIZE.w + 40),
                          y: 40 + Math.floor(k / 2) * (TEAM_DEFAULT_SIZE.h + 40),
                          ...TEAM_DEFAULT_SIZE,
                        });
                        await load();
                      })
                    }
                  >
                    <PlusIcon className="size-4" aria-hidden="true" /> New team
                  </Button>
                </Tip>
              </div>
              <div
                className="min-h-0 flex-1"
                role="application"
                aria-label="Teams canvas. Drag bots into a team group."
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={onDrop}
              >
                <ReactFlow
                  colorMode={resolvedTheme === "light" ? "light" : "dark"}
                  nodes={nodes}
                  edges={[]}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onNodeClick={(_, n) => {
                    if (n.type === "bot") void openSettings(n.id);
                  }}
                  deleteKeyCode={null}
                  onNodeDragStop={(_, n) => {
                    if (n.type !== "bot") return;
                    const parent = nodes.find((x) => x.id === n.parentId);
                    if (!parent) return;
                    setNodes((ns) =>
                      dropBot(
                        ns.map((x) => (x.id === n.id ? { ...x, position: n.position } : x)),
                        n.id,
                        {
                          x: parent.position.x + n.position.x,
                          y: parent.position.y + n.position.y,
                        },
                      ),
                    );
                  }}
                  fitView
                >
                  <Background />
                  <Controls />
                </ReactFlow>
              </div>
            </main>
          </div>
        </TeamActions.Provider>
      </RolesContext.Provider>
    </BotsContext.Provider>
  );
}

export function TeamsCanvas() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

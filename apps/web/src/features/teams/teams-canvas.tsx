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
import { useNavigate } from "@tanstack/react-router";
import { Crown, Plus, Settings2 } from "lucide-react";
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
import { toast } from "sonner";

import { Tooltip } from "@g4rcez/components/tooltip";
import { cn } from "@zetta/ui/lib/utils";
import { BotIdentity, BotsContext, useBotIdentity } from "@/components/bot-identity";
import { Drawer } from "@/components/drawer";
import { Button, Input, Textarea } from "@/components/ui";
import { useTheme } from "../../components/theme-provider";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import {
  addBot,
  BOT_SIZE,
  dropBot,
  dropTarget,
  flowToTeams,
  groupsOf,
  makeChief,
  normalizeChiefs,
  teamsToFlow,
  type BotNode,
  type TeamNode,
  type TeamsNode,
} from "./team-graph";
import { TEAM_SIZE_WARNING, TEAM_SIZE_WARNING_AT, teamsApi, type TeamSave } from "./teams-api";

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
const TeamActions = createContext<{ configure: (nodeId: string) => void }>({ configure: () => {} });
const titleButton =
  "nodrag grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function TeamGroup({ id, data, selected }: NodeProps<TeamNode>) {
  const actions = useContext(TeamActions);
  return (
    <>
      <NodeResizer minWidth={260} minHeight={180} isVisible={selected} />
      <div
        className={cn(
          "flex h-full w-full flex-col rounded-lg border-2 border-dashed bg-card/40",
          selected && "border-primary",
        )}
      >
        <div className="team-handle flex cursor-grab items-center gap-1 border-b py-1 pr-1.5 pl-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{data.name}</p>
          <Tip tip="Configure this team: name, goal and rooms" className="nodrag">
            <button
              type="button"
              className={titleButton}
              aria-label={`Configure ${data.name}`}
              onClick={() => actions.configure(id)}
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </button>
          </Tip>
        </div>
        {data.goal && (
          <p className="line-clamp-2 px-3 py-1 text-xs text-muted-foreground">{data.goal}</p>
        )}
      </div>
    </>
  );
}

function BotCard({ data, selected }: NodeProps<BotNode>) {
  const bot = useBotIdentity(data.botId, data.name);
  return (
    <div
      style={{ width: BOT_SIZE.w, height: BOT_SIZE.h }}
      className={cn(
        "flex items-center rounded-md border bg-card px-2 text-xs shadow",
        data.kind === "chief" && "border-amber-500",
        selected && "ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" isConnectable={false} />
      <BotIdentity
        bot={bot}
        size={28}
        sub={data.role || (data.kind === "chief" ? "Chief" : "Member")}
        trailing={
          data.kind === "chief" ? (
            <Crown className="size-3 shrink-0 text-amber-500" aria-label="Chief" />
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
  const [nodes, setNodes, onNodesChange] = useNodesState<TeamsNode>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [drawerId, setDrawerId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const synced = useRef(new Map<string, { version: number; key: string }>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [room, setRoom] = useState({ title: "", firstMessage: "" });
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);
  const load = useCallback(async () => {
    try {
      const flow = teamsToFlow(await teamsApi.list());
      synced.current = new Map(
        flowToTeams(flow).map((t) => [
          t.id,
          { version: t.save.expectedVersion, key: saveKey(t.save) },
        ]),
      );
      setNodes(flow);
    } catch (e) {
      fail(e);
    }
  }, [setNodes, fail]);
  useEffect(() => {
    void load();
    chatClient.bots().then((b) => setBots(b.filter((x) => x.onboarded)), fail);
  }, [load, fail]);

  const selected = nodes.find((n) => n.id === drawerId);
  const teamOf =
    selected?.type === "team"
      ? selected
      : nodes.find((n): n is TeamNode => n.id === (selected as BotNode | undefined)?.parentId);
  const memberNodes = teamOf
    ? nodes
        .filter((n): n is BotNode => n.type === "bot" && n.parentId === teamOf.id)
        .sort((a, b) => Number(b.data.kind === "chief") - Number(a.data.kind === "chief"))
    : [];
  const members = memberNodes.length;
  const patch = (id: string, p: Record<string, unknown>) =>
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...p } } as TeamsNode) : n)),
    );

  async function work(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    }
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
  const actions = useMemo(() => ({ configure: setDrawerId }), []);

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
                        x: 40 + (k % 2) * 420,
                        y: 40 + Math.floor(k / 2) * 320,
                        w: 360,
                        h: 280,
                      });
                      await load();
                    })
                  }
                >
                  <Plus className="size-4" aria-hidden="true" /> New team
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
                  if (n.type === "bot") setDrawerId(n.id);
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
                      { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y },
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
          {selected && teamOf && (
            <Drawer
              open
              onClose={() => setDrawerId(undefined)}
              title={
                selected.type === "team" ? (
                  selected.data.name
                ) : (
                  <BotIdentity
                    size={40}
                    bot={
                      botsById.get(selected.data.botId) ?? {
                        id: selected.data.botId,
                        name: selected.data.name,
                      }
                    }
                    sub={selected.data.kind === "chief" ? "Chief of this team" : "Member"}
                  />
                )
              }
              description={
                selected.type === "team"
                  ? "Settings and rooms for this team"
                  : `In team ${teamOf.data.name}`
              }
              footer={
                <div className="flex w-full items-center justify-between gap-2">
                  {selected.type === "team" ? (
                    <Tip tip="Delete this team. Rooms already opened stay.">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Delete team "${selected.data.name}"?`))
                            void work(async () => {
                              await teamsApi.archive(selected.data.teamId);
                              setDrawerId(undefined);
                              await load();
                            });
                        }}
                      >
                        Delete team
                      </Button>
                    </Tip>
                  ) : (
                    <Tip tip="Take this bot out of the team">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNodes((ns) => normalizeChiefs(ns.filter((n) => n.id !== selected.id)));
                          setDrawerId(undefined);
                        }}
                      >
                        Remove from team
                      </Button>
                    </Tip>
                  )}
                </div>
              }
            >
              {selected.type === "team" ? (
                <div className="flex flex-col gap-6">
                  <section className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold">Team</h3>
                    <Input
                      title="Name"
                      reportStatus={false}
                      value={selected.data.name}
                      maxLength={80}
                      onChange={(e) => patch(selected.id, { name: e.target.value })}
                    />
                    <Textarea
                      title="Goal"
                      reportStatus={false}
                      required={false}
                      rows={3}
                      maxLength={1000}
                      value={selected.data.goal}
                      onChange={(e) => patch(selected.id, { goal: e.target.value })}
                    />
                    <p className="-mt-1 text-xs text-muted-foreground">
                      Optional. Without one, the chief follows each prompt.
                    </p>
                    {members > TEAM_SIZE_WARNING_AT && (
                      <p
                        role="status"
                        className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
                      >
                        {TEAM_SIZE_WARNING}
                      </p>
                    )}
                  </section>
                  <section className="flex flex-col gap-3 border-t pt-6">
                    <h3 className="text-sm font-semibold">Members</h3>
                    {memberNodes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No bots yet. Drag a bot from the list into the team.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {memberNodes.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              className="flex w-full rounded-lg border bg-card px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                              onClick={() => setDrawerId(m.id)}
                            >
                              <BotIdentity
                                bot={
                                  botsById.get(m.data.botId) ?? {
                                    id: m.data.botId,
                                    name: m.data.name,
                                  }
                                }
                                size={28}
                                sub={m.data.role || (m.data.kind === "chief" ? "Chief" : "Member")}
                                trailing={
                                  m.data.kind === "chief" ? (
                                    <Crown
                                      className="size-3 shrink-0 text-amber-500"
                                      aria-label="Chief"
                                    />
                                  ) : undefined
                                }
                                className="w-full"
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="flex flex-col gap-3 border-t pt-6">
                    <h3 className="text-sm font-semibold">Start a room</h3>
                    <Input
                      title="Room title"
                      reportStatus={false}
                      required={false}
                      value={room.title}
                      maxLength={120}
                      onChange={(e) => setRoom({ ...room, title: e.target.value })}
                    />
                    <Textarea
                      title="First order for the chief"
                      reportStatus={false}
                      required={false}
                      rows={4}
                      maxLength={4000}
                      value={room.firstMessage}
                      onChange={(e) => setRoom({ ...room, firstMessage: e.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <Tip tip="Open a room: the chief gets your first order and coordinates the team">
                        <Button
                          size="sm"
                          disabled={
                            busy || members < 2 || !room.title.trim() || !room.firstMessage.trim()
                          }
                          onClick={() =>
                            void work(async () => {
                              await sync(nodes);
                              const id = await teamsApi.startRoom(teamOf.data.teamId, {
                                title: room.title.trim(),
                                firstMessage: room.firstMessage.trim(),
                              });
                              await navigate({
                                to: "/discussions",
                                search: { id, view: "canvas" },
                              });
                            })
                          }
                        >
                          Start a room
                        </Button>
                      </Tip>
                      {members < 2 && (
                        <p className="text-xs text-muted-foreground">
                          Add a chief and at least one more bot first.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Input
                    title="Role in this team"
                    reportStatus={false}
                    required={false}
                    value={selected.data.role}
                    maxLength={200}
                    onChange={(e) => patch(selected.id, { role: e.target.value })}
                  />
                  <Tip
                    tip="Make this bot the chief: it gets your orders first and coordinates the others"
                    className="self-start"
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      disabled={selected.data.kind === "chief"}
                      onClick={() => setNodes((ns) => makeChief(ns, selected.id))}
                    >
                      Make chief
                    </Button>
                  </Tip>
                </div>
              )}
            </Drawer>
          )}
        </div>
      </TeamActions.Provider>
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

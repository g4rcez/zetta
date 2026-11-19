import { uuidv7 } from "@zetta/core/uuid";
import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { BotSelect } from "@/components/bot-select";
import { Button, Input, Select } from "@/components/ui";

import { ApiError, call, errorMessage, type Bot } from "../chat/chat-client";
import { useTheme } from "../../components/theme-provider";

import {
  flowToGraph,
  freshId,
  graphToFlow,
  handlesOf,
  hasRetry,
  KIND_LABEL,
  localProblems,
  newNode,
  parseArgs,
  type FlowNode,
  type NodeData,
  type NodeKind,
  type ServerGraph,
  type ToolKind,
} from "./workflow-graph";

const STATE_STYLE: Record<string, string> = {
  done: "border-success",
  failed: "border-destructive",
  skipped: "opacity-50",
  waiting: "border-dashed",
};
/** The names of the outputs of a step on the canvas. */
const HANDLE_LABEL: Record<string, string> = { body: "each item", next: "then" };
const summaryOf = (data: NodeData) =>
  data.kind === "prompt"
    ? (data.template ?? "").slice(0, 40)
    : data.kind === "browse"
      ? data.url
      : data.kind === "decision"
        ? data.question
        : data.kind === "condition"
          ? `contains "${data.contains}"`
          : data.kind === "tool"
            ? `${data.tool || "…"} (${data.toolKind ?? "plugin"} ${data.target || "…"})`
            : data.kind === "approval"
              ? data.message
              : data.kind === "wait"
                ? data.until
                  ? `until ${data.until}`
                  : `${data.seconds ?? 0} s`
                : data.kind === "for_each"
                  ? `one pass per ${data.items === "json" ? "list entry" : "line"}`
                  : "";

function ZettaNode({ data, selected }: NodeProps<FlowNode>) {
  const handles = handlesOf(data);
  const summary = summaryOf(data);
  return (
    <div
      className={`min-w-40 rounded border bg-card px-3 py-2 text-xs shadow ${selected ? "ring-2 ring-primary" : ""} ${data.state ? STATE_STYLE[data.state] : ""}`}
    >
      <Handle type="target" position={Position.Left} aria-label="Input" />
      <p className="font-medium">
        {KIND_LABEL[data.kind]}{" "}
        {data.isStart && (
          <span className="rounded bg-primary px-1 text-primary-foreground">start</span>
        )}
      </p>
      {summary && <p className="max-w-48 truncate text-muted-foreground">{summary}</p>}
      {data.state && (
        <p aria-label={`Run result: ${data.state}`}>
          {data.state === "done"
            ? "✓ done"
            : data.state === "failed"
              ? "✗ failed"
              : data.state === "waiting"
                ? "⏸ waiting"
                : "– skipped"}
        </p>
      )}
      {handles.map((h, i) => (
        <div key={h} className="relative mt-1 flex justify-end text-xs text-muted-foreground">
          {handles.length > 1 && (
            <span className="pr-2">{HANDLE_LABEL[h] ?? h.replace("choice:", "")}</span>
          )}
          <Handle
            type="source"
            id={h}
            position={Position.Right}
            style={
              handles.length > 1
                ? {
                    top: "auto",
                    bottom: "auto",
                    position: "relative",
                    transform: "none",
                    marginTop: i === 0 ? 0 : 2,
                  }
                : undefined
            }
            aria-label={`Output ${h}`}
          />
        </div>
      ))}
    </div>
  );
}
const nodeTypes = { zetta: ZettaNode };
type Trace = { node: string; type?: string; error?: string; skipped?: boolean }[];

function Editor({
  bots,
  initial,
  workflow,
  onSaved,
  onError,
}: {
  bots: Bot[];
  initial: ServerGraph;
  workflow?: { id: string; name: string; version: number };
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const seed = useMemo(() => graphToFlow(initial), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed.edges);
  const [start, setStart] = useState(initial.start);
  const [name, setName] = useState(workflow?.name ?? "");
  const [selectedId, setSelectedId] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);
  const [info, setInfo] = useState<string>();
  const selected = nodes.find((n) => n.id === selectedId);

  const graph = useCallback(
    () =>
      flowToGraph(
        nodes.map((n) => ({ ...n, data: { ...n.data, state: undefined, isStart: undefined } })),
        edges,
        start,
      ),
    [nodes, edges, start],
  );
  const patch = (id: string, p: Partial<NodeData>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)));
  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) =>
        addEdge(
          {
            ...c,
            id: `${c.source}:${c.sourceHandle ?? "next"}`,
            label: c.sourceHandle?.replace("choice:", ""),
          },
          es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle)),
        ),
      ),
    [setEdges],
  );
  const add = (kind: NodeKind) => {
    const id = freshId(nodes.map((n) => n.id));
    const x = 40 + (nodes.length % 3) * 280,
      y = 40 + Math.floor(nodes.length / 3) * 150;
    setNodes((ns) => [...ns, newNode(id, kind, { x, y }, bots[0]?.id ?? "")]);
    if (nodes.length === 0) setStart(id);
    setSelectedId(id);
  };
  const remove = () => {
    if (!selectedId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
    if (start === selectedId) setStart(nodes.find((n) => n.id !== selectedId)?.id ?? "");
    setSelectedId(undefined);
  };
  const marked = nodes.map((n) => ({ ...n, data: { ...n.data, isStart: n.id === start } }));

  async function validate() {
    const g = graph();
    const badArgs = nodes
      .filter((n) => n.data.kind === "tool" && parseArgs(n.data.argsText) === undefined)
      .map((n) => `"${n.id}": the arguments are not a JSON object.`);
    const local = [...badArgs, ...localProblems(g)];
    if (local.length) {
      setProblems(local);
      return false;
    }
    try {
      const r = await call<{ ok: boolean; problems?: string[] }>(
        "/api/workflows/validate",
        "POST",
        { graph: g },
      );
      setProblems(r.ok ? [] : (r.problems ?? []));
      if (r.ok) setInfo("The flow is valid.");
      return r.ok;
    } catch (e) {
      onError(errorMessage(e));
      return false;
    }
  }
  async function save() {
    setInfo(undefined);
    if (!name.trim()) {
      setProblems(["Give the workflow a name."]);
      return;
    }
    if (!(await validate())) return;
    try {
      await call("/api/workflows", "POST", {
        ...(workflow ? { id: workflow.id, expectedVersion: workflow.version } : {}),
        name: name.trim(),
        graph: graph(),
      });
      setInfo("Saved.");
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_VERSION")
        setProblems(["Someone changed this workflow. Reload it and apply your edits again."]);
      else onError(errorMessage(e));
    }
  }
  async function run() {
    if (!workflow) {
      setInfo("Save the workflow first, then run it.");
      return;
    }
    try {
      const r = await call<{ run: { status: string; trace: Trace } }>(
        `/api/workflows/${workflow.id}/run`,
        "POST",
        { input: "", requestKey: uuidv7() },
      );
      const byNode = new Map(r.run.trace.map((t) => [t.node, t]));
      // A run that is waiting stopped at its last step (a wait, or a question for you): that one is drawn as waiting.
      const last = r.run.status === "waiting" ? r.run.trace.at(-1)?.node : undefined;
      setNodes((ns) =>
        ns.map((n) => {
          const t = byNode.get(n.id);
          return {
            ...n,
            data: {
              ...n.data,
              state: !t
                ? undefined
                : t.error
                  ? "failed"
                  : t.skipped
                    ? "skipped"
                    : n.id === last
                      ? "waiting"
                      : "done",
            },
          };
        }),
      );
      setInfo(
        r.run.status === "waiting"
          ? "The run is waiting. It goes on by itself when the time comes or when you answer its card in the Inbox."
          : `Run ${r.run.status}. Colours on the canvas show what ran.`,
      );
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-2" aria-label="Workflow canvas editor">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          title="Name"
          container="w-56"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        {(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => (
          <Button key={k} size="sm" variant="outline" type="button" onClick={() => add(k)}>
            + {KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      <div
        className="h-[420px] rounded border"
        role="application"
        aria-label="Flow canvas. Drag from an output dot to an input dot to connect steps."
      >
        <ReactFlow
          colorMode={resolvedTheme === "light" ? "light" : "dark"}
          nodes={marked}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(undefined)}
          fitView
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      {selected && (
        <fieldset
          className="grid gap-2 rounded-lg border bg-card p-4 sm:grid-cols-2"
          aria-label={`Edit ${KIND_LABEL[selected.data.kind]}`}
        >
          <legend className="px-1 text-sm">
            {KIND_LABEL[selected.data.kind]} ({selected.id})
          </legend>
          {selected.data.kind === "prompt" && (
            <>
              <BotSelect
                label="Bot"
                bots={bots}
                value={selected.data.botId}
                onChange={(botId) => patch(selected.id, { botId })}
              />
              <Input
                title="Instruction ({{prev}} = previous output, {{input}} = run input)"
                value={selected.data.template}
                onChange={(e) => patch(selected.id, { template: e.target.value })}
              />
            </>
          )}
          {selected.data.kind === "browse" && (
            <Input
              title="Web address"
              container="sm:col-span-2"
              value={selected.data.url}
              onChange={(e) => patch(selected.id, { url: e.target.value })}
            />
          )}
          {selected.data.kind === "condition" && (
            <Input
              title="Continue when the previous answer contains"
              container="sm:col-span-2"
              value={selected.data.contains}
              onChange={(e) => patch(selected.id, { contains: e.target.value })}
            />
          )}
          {selected.data.kind === "decision" && (
            <>
              <Input
                title="Question"
                value={selected.data.question}
                onChange={(e) => patch(selected.id, { question: e.target.value })}
              />
              <Input
                title="Choices (comma separated; each gets its own output)"
                value={(selected.data.choices ?? []).join(", ")}
                onChange={(e) => {
                  const choices = e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 12);
                  patch(selected.id, { choices });
                  setEdges((es) =>
                    es.filter(
                      (x) =>
                        x.source !== selected.id ||
                        choices.includes((x.sourceHandle ?? "").replace("choice:", "")),
                    ),
                  );
                }}
              />
            </>
          )}
          {selected.data.kind === "tool" && (
            <>
              <BotSelect
                label="Bot (its grants are used)"
                bots={bots}
                value={selected.data.botId}
                onChange={(botId) => patch(selected.id, { botId })}
              />
              <Select
                title="Kind of tool"
                required={false}
                value={selected.data.toolKind ?? "plugin"}
                onChange={(e) => patch(selected.id, { toolKind: e.target.value as ToolKind })}
                options={[
                  { value: "plugin", label: "Plugin" },
                  { value: "mcp", label: "MCP server" },
                  { value: "app", label: "App" },
                  { value: "zetta", label: "Zetta (target: lessons)" },
                ]}
              />
              <Input
                title="Plugin id, MCP server name, app, or lessons for Zetta"
                value={selected.data.target ?? ""}
                onChange={(e) => patch(selected.id, { target: e.target.value })}
              />
              <Input
                title="Tool name"
                value={selected.data.tool ?? ""}
                onChange={(e) => patch(selected.id, { tool: e.target.value })}
              />
              <Input
                title="Arguments as JSON ({{prev}}, {{input}}, {{item}} and {{steps.id}} are filled in)"
                container="sm:col-span-2"
                value={selected.data.argsText ?? "{}"}
                onChange={(e) => patch(selected.id, { argsText: e.target.value })}
              />
              <p className="text-xs text-muted-foreground sm:col-span-2">
                A tool that changes something needs an "Ask me first" step right before it. The
                server checks this when you save.
              </p>
            </>
          )}
          {selected.data.kind === "approval" && (
            <Input
              title="What to ask you (it arrives as a card in the Inbox)"
              container="sm:col-span-2"
              value={selected.data.message ?? ""}
              maxLength={500}
              onChange={(e) => patch(selected.id, { message: e.target.value })}
            />
          )}
          {selected.data.kind === "wait" && (
            <>
              <Input
                title="Wait this many seconds (up to 7 days)"
                type="number"
                min={1}
                max={604800}
                value={selected.data.until ? "" : String(selected.data.seconds ?? "")}
                onChange={(e) => {
                  const seconds = Number(e.target.value);
                  patch(selected.id, {
                    seconds:
                      Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : undefined,
                    until: undefined,
                  });
                }}
              />
              <Input
                title="Or wait until this time (for example 2026-12-01T09:00:00Z)"
                value={selected.data.until ?? ""}
                onChange={(e) =>
                  patch(
                    selected.id,
                    e.target.value
                      ? { until: e.target.value, seconds: undefined }
                      : { until: undefined },
                  )
                }
              />
            </>
          )}
          {selected.data.kind === "for_each" && (
            <>
              <Select
                title="Split the previous answer into"
                required={false}
                value={selected.data.items ?? "lines"}
                onChange={(e) => patch(selected.id, { items: e.target.value as "lines" | "json" })}
                options={[
                  { value: "lines", label: "One item per line" },
                  { value: "json", label: "The entries of a JSON list" },
                ]}
              />
              <Input
                title="At most this many items (up to 20)"
                type="number"
                min={1}
                max={20}
                value={String(selected.data.max ?? 20)}
                onChange={(e) =>
                  patch(selected.id, {
                    max: Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 20))),
                  })
                }
              />
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Connect "each item" to the first step of the loop, and end that chain with "End of
                item". Use {"{{item}}"} in its steps. "then" goes on after the last item, with the
                answers numbered.
              </p>
            </>
          )}
          {hasRetry(selected.data.kind) && (
            <>
              <Input
                title="Try again after a failure (0 to 3 more times)"
                type="number"
                min={0}
                max={3}
                value={String(selected.data.retryMax ?? 0)}
                onChange={(e) =>
                  patch(selected.id, {
                    retryMax: Math.min(3, Math.max(0, Math.round(Number(e.target.value) || 0))),
                  })
                }
              />
              {(selected.data.retryMax ?? 0) > 0 && (
                <Input
                  title="Wait between tries (milliseconds)"
                  type="number"
                  min={0}
                  max={60000}
                  value={String(selected.data.retryDelayMs ?? 1000)}
                  onChange={(e) =>
                    patch(selected.id, {
                      retryDelayMs: Math.min(
                        60000,
                        Math.max(0, Math.round(Number(e.target.value) || 0)),
                      ),
                    })
                  }
                />
              )}
            </>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setStart(selected.id)}
              disabled={start === selected.id}
            >
              Make this the start
            </Button>
            <Button size="sm" variant="destructive" type="button" onClick={remove}>
              Delete step
            </Button>
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="button" onClick={() => void save()}>
          Save workflow
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={() => void validate()}>
          Check
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => void run()}
          disabled={!workflow}
        >
          Run
        </Button>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {info && (
        <p role="status" className="text-sm">
          {info}
        </p>
      )}
    </div>
  );
}

export function WorkflowCanvas(props: {
  bots: Bot[];
  initial?: ServerGraph;
  workflow?: { id: string; name: string; version: number };
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <Editor {...props} initial={props.initial ?? { start: "", nodes: {} }} />
    </ReactFlowProvider>
  );
}

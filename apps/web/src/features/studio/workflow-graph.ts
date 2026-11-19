import type { Edge, Node } from "@xyflow/react";

/** Canvas <-> server graph conversion. Pure, so it can be tested without a browser. */
export type NodeKind =
  | "prompt"
  | "browse"
  | "decision"
  | "condition"
  | "sources"
  | "tool"
  | "approval"
  | "wait"
  | "for_each"
  | "item_end"
  | "end";
export type ToolKind = "plugin" | "mcp" | "app" | "zetta";
export type NodeData = {
  kind: NodeKind;
  botId?: string;
  template?: string;
  url?: string;
  question?: string;
  choices?: string[];
  contains?: string;
  /** A `tool` step: where the tool lives, its name and its arguments as JSON text. */
  toolKind?: ToolKind;
  target?: string;
  tool?: string;
  argsText?: string;
  /** An `approval` step: what the person is asked. */
  message?: string;
  /** A `wait` step: a number of seconds, or a time (an ISO text). */
  seconds?: number;
  until?: string;
  /** A `for_each` step: what the previous answer is split into, and at most how many items. */
  items?: "lines" | "json";
  max?: number;
  /** More tries after a failure (prompt, browse, sources and tool steps). 0 or missing: none. */
  retryMax?: number;
  retryDelayMs?: number;
  isStart?: boolean;
  state?: "done" | "failed" | "skipped" | "waiting";
  [k: string]: unknown;
};
export type FlowNode = Node<NodeData>;
type Retry = { retry?: { max: number; delayMs: number } };
export type ServerNode =
  | ({ type: "prompt"; botId: string; template: string; next?: string } & Retry)
  | ({ type: "browse"; url: string; next?: string } & Retry)
  | ({ type: "sources"; next?: string } & Retry)
  | ({
      type: "tool";
      botId: string;
      kind: ToolKind;
      target: string;
      tool: string;
      args?: Record<string, unknown>;
      next?: string;
    } & Retry)
  | { type: "approval"; message: string; next?: string }
  | { type: "wait"; seconds?: number; until?: string; next?: string }
  | { type: "for_each"; items: "lines" | "json"; body: string; max?: number; next?: string }
  | { type: "item_end" }
  | { type: "decision"; question: string; choices: Record<string, string> }
  | { type: "condition"; contains: string; then: string; else: string }
  | { type: "end" };
export type ServerGraph = {
  start: string;
  nodes: Record<string, ServerNode>;
  layout?: Record<string, { x: number; y: number }>;
};

export const KIND_LABEL: Record<NodeKind, string> = {
  prompt: "Ask a bot",
  browse: "Read a web page",
  decision: "Decide (Laya)",
  condition: "Check the answer",
  sources: "Read my sources",
  tool: "Use a tool",
  approval: "Ask me first",
  wait: "Wait",
  for_each: "For each item",
  item_end: "End of item",
  end: "Finish",
};
const RETRY_KINDS = new Set<NodeKind>(["prompt", "browse", "sources", "tool"]);
export const hasRetry = (kind: NodeKind) => RETRY_KINDS.has(kind);

/** Source handles per kind: where an outgoing connection starts. Decision handles are `choice:<label>`; a loop has `body` and `next`. */
export const handlesOf = (d: NodeData): string[] =>
  d.kind === "condition"
    ? ["then", "else"]
    : d.kind === "decision"
      ? (d.choices ?? []).map((c) => `choice:${c}`)
      : d.kind === "for_each"
        ? ["body", "next"]
        : d.kind === "end" || d.kind === "item_end"
          ? []
          : ["next"];

export function newNode(
  id: string,
  kind: NodeKind,
  position: { x: number; y: number },
  botId = "",
): FlowNode {
  const base: NodeData =
    kind === "prompt"
      ? { kind, botId, template: "{{prev}}" }
      : kind === "browse"
        ? { kind, url: "https://" }
        : kind === "decision"
          ? { kind, question: "Which is it?", choices: ["yes", "no"] }
          : kind === "condition"
            ? { kind, contains: "ok" }
            : kind === "tool"
              ? { kind, botId, toolKind: "plugin", target: "", tool: "", argsText: "{}" }
              : kind === "approval"
                ? { kind, message: "Go on?" }
                : kind === "wait"
                  ? { kind, seconds: 3600 }
                  : kind === "for_each"
                    ? { kind, items: "lines", max: 20 }
                    : { kind };
  return { id, type: "zetta", position, data: base };
}

const retryOf = (d: NodeData): Retry =>
  hasRetry(d.kind) && d.retryMax && d.retryMax > 0
    ? {
        retry: {
          max: Math.min(3, Math.round(d.retryMax)),
          delayMs: Math.max(0, Math.round(d.retryDelayMs ?? 1000)),
        },
      }
    : {};

export function graphToFlow(g: ServerGraph): { nodes: FlowNode[]; edges: Edge[] } {
  const depth = new Map<string, number>();
  const queue = [g.start];
  depth.set(g.start, 0);
  const outs = (n: ServerNode): string[] =>
    n.type === "condition"
      ? [n.then, n.else]
      : n.type === "decision"
        ? Object.values(n.choices)
        : n.type === "for_each"
          ? [n.body, ...(n.next ? [n.next] : [])]
          : "next" in n && n.next
            ? [n.next]
            : [];
  while (queue.length) {
    const id = queue.shift()!;
    const n = g.nodes[id];
    if (!n) continue;
    for (const o of outs(n))
      if (!depth.has(o)) {
        depth.set(o, depth.get(id)! + 1);
        queue.push(o);
      }
  }
  const perColumn = new Map<number, number>();
  const nodes: FlowNode[] = Object.entries(g.nodes).map(([id, n]) => {
    const col = depth.get(id) ?? 0;
    const row = perColumn.get(col) ?? 0;
    perColumn.set(col, row + 1);
    const pos = g.layout?.[id] ?? { x: col * 260, y: row * 150 };
    const retry =
      "retry" in n && n.retry ? { retryMax: n.retry.max, retryDelayMs: n.retry.delayMs } : {};
    const data: NodeData =
      n.type === "prompt"
        ? { kind: "prompt", botId: n.botId, template: n.template, ...retry }
        : n.type === "browse"
          ? { kind: "browse", url: n.url, ...retry }
          : n.type === "sources"
            ? { kind: "sources", ...retry }
            : n.type === "tool"
              ? {
                  kind: "tool",
                  botId: n.botId,
                  toolKind: n.kind,
                  target: n.target,
                  tool: n.tool,
                  argsText: JSON.stringify(n.args ?? {}),
                  ...retry,
                }
              : n.type === "approval"
                ? { kind: "approval", message: n.message }
                : n.type === "wait"
                  ? {
                      kind: "wait",
                      ...(n.seconds !== undefined ? { seconds: n.seconds } : {}),
                      ...(n.until !== undefined ? { until: n.until } : {}),
                    }
                  : n.type === "for_each"
                    ? {
                        kind: "for_each",
                        items: n.items,
                        ...(n.max !== undefined ? { max: n.max } : {}),
                      }
                    : n.type === "decision"
                      ? { kind: "decision", question: n.question, choices: Object.keys(n.choices) }
                      : n.type === "condition"
                        ? { kind: "condition", contains: n.contains }
                        : { kind: n.type };
    return { id, type: "zetta", position: pos, data: { ...data, isStart: id === g.start } };
  });
  const edges: Edge[] = [];
  for (const [id, n] of Object.entries(g.nodes)) {
    if (n.type === "condition") {
      edges.push(
        // oxlint-disable-next-line unicorn/no-thenable
        { id: `${id}:then`, source: id, sourceHandle: "then", target: n.then, label: "contains" },
        { id: `${id}:else`, source: id, sourceHandle: "else", target: n.else, label: "otherwise" },
      );
    } else if (n.type === "decision")
      for (const [label, target] of Object.entries(n.choices))
        edges.push({
          id: `${id}:choice:${label}`,
          source: id,
          sourceHandle: `choice:${label}`,
          target,
          label,
        });
    else if (n.type === "for_each") {
      edges.push({
        id: `${id}:body`,
        source: id,
        sourceHandle: "body",
        target: n.body,
        label: "each item",
      });
      if (n.next)
        edges.push({
          id: `${id}:next`,
          source: id,
          sourceHandle: "next",
          target: n.next,
          label: "then",
        });
    } else if ("next" in n && n.next)
      edges.push({ id: `${id}:next`, source: id, sourceHandle: "next", target: n.next });
  }
  return { nodes, edges };
}

/** Reads the arguments text of a tool step: an object, or undefined when the text is not one. */
export const parseArgs = (text: string | undefined): Record<string, unknown> | undefined => {
  const t = (text ?? "").trim();
  if (!t) return {};
  try {
    const v: unknown = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Builds the server graph from the canvas. Unconnected outputs stay unset (the server reports them); conditions/decisions need all branches. */
export function flowToGraph(nodes: FlowNode[], edges: Edge[], start: string): ServerGraph {
  const target = (id: string, handle: string) =>
    edges.find((e) => e.source === id && (e.sourceHandle ?? "next") === handle)?.target;
  const next = (id: string) => {
    const t = target(id, "next");
    return t ? { next: t } : {};
  };
  const out: Record<string, ServerNode> = {};
  const layout: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const d = n.data;
    layout[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    if (d.kind === "prompt")
      out[n.id] = {
        type: "prompt",
        botId: d.botId ?? "",
        template: d.template ?? "",
        ...retryOf(d),
        ...next(n.id),
      };
    else if (d.kind === "browse")
      out[n.id] = { type: "browse", url: d.url ?? "", ...retryOf(d), ...next(n.id) };
    else if (d.kind === "sources") out[n.id] = { type: "sources", ...retryOf(d), ...next(n.id) };
    else if (d.kind === "tool")
      out[n.id] = {
        type: "tool",
        botId: d.botId ?? "",
        kind: d.toolKind ?? "plugin",
        target: d.target ?? "",
        tool: d.tool ?? "",
        args: parseArgs(d.argsText) ?? {},
        ...retryOf(d),
        ...next(n.id),
      };
    else if (d.kind === "approval")
      out[n.id] = { type: "approval", message: d.message ?? "", ...next(n.id) };
    else if (d.kind === "wait")
      out[n.id] = {
        type: "wait",
        ...(d.until ? { until: d.until } : { seconds: d.seconds ?? 60 }),
        ...next(n.id),
      };
    else if (d.kind === "for_each")
      out[n.id] = {
        type: "for_each",
        items: d.items ?? "lines",
        body: target(n.id, "body") ?? "",
        ...(d.max ? { max: d.max } : {}),
        ...next(n.id),
      };
    // oxlint-disable-next-line unicorn/no-thenable
    else if (d.kind === "condition")
      out[n.id] = {
        type: "condition",
        contains: d.contains ?? "",
        // oxlint-disable-next-line unicorn/no-thenable
        then: target(n.id, "then") ?? "",
        else: target(n.id, "else") ?? "",
      };
    else if (d.kind === "decision")
      out[n.id] = {
        type: "decision",
        question: d.question ?? "",
        choices: Object.fromEntries(
          (d.choices ?? []).map((c) => [c, target(n.id, `choice:${c}`) ?? ""]),
        ),
      };
    else if (d.kind === "item_end") out[n.id] = { type: "item_end" };
    else out[n.id] = { type: "end" };
  }
  return { start, nodes: out, layout };
}

/** Client-side hints before saving; the server remains the authority (cycles, unreachable steps, bounds, loops, tools that change things). */
export function localProblems(g: ServerGraph): string[] {
  const p: string[] = [];
  if (Object.keys(g.nodes).length === 0) return ["Add at least one step."];
  if (!g.nodes[g.start]) p.push("Choose a start step.");
  if (!Object.values(g.nodes).some((n) => n.type === "end")) p.push("Add a Finish step.");
  for (const [id, n] of Object.entries(g.nodes)) {
    if (n.type === "condition" && (!n.then || !n.else))
      p.push(`"${id}" needs both branches connected.`);
    if (n.type === "decision" && Object.values(n.choices).some((t) => !t))
      p.push(`"${id}" has a choice that goes nowhere.`);
    if ((n.type === "prompt" || n.type === "tool") && !n.botId) p.push(`"${id}" needs a bot.`);
    if (n.type === "tool" && (!n.target.trim() || !n.tool.trim()))
      p.push(`"${id}" needs the name of a tool and where it lives.`);
    if (n.type === "approval" && !n.message.trim()) p.push(`"${id}" needs a question for you.`);
    if (n.type === "wait" && n.seconds === undefined && !n.until)
      p.push(`"${id}" needs a time to wait.`);
    if (n.type === "for_each" && !n.body) p.push(`"${id}" needs its "each item" output connected.`);
  }
  return p;
}

let counter = 0;
export function freshId(existing: string[]) {
  let id: string;
  do {
    id = `n${++counter}`;
  } while (existing.includes(id));
  return id;
}

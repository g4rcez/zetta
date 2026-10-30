import type { Edge, Node } from "@xyflow/react";

/** Canvas <-> server graph conversion. Pure, so it can be tested without a browser. */
export type NodeKind = "prompt" | "browse" | "decision" | "condition" | "sources" | "end";
export type NodeData = {
  kind: NodeKind;
  botId?: string;
  template?: string;
  url?: string;
  question?: string;
  choices?: string[];
  contains?: string;
  isStart?: boolean;
  state?: "done" | "failed" | "skipped";
  [k: string]: unknown;
};
export type FlowNode = Node<NodeData>;
export type ServerNode =
  | { type: "prompt"; botId: string; template: string; next?: string }
  | { type: "browse"; url: string; next?: string }
  | { type: "sources"; next?: string }
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
  end: "Finish",
};
/** Source handles per kind: where an outgoing connection starts. Decision handles are `choice:<label>`. */
export const handlesOf = (d: NodeData): string[] =>
  d.kind === "condition"
    ? ["then", "else"]
    : d.kind === "decision"
      ? (d.choices ?? []).map((c) => `choice:${c}`)
      : d.kind === "end"
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
            : { kind };
  return { id, type: "zetta", position, data: base };
}

export function graphToFlow(g: ServerGraph): { nodes: FlowNode[]; edges: Edge[] } {
  const depth = new Map<string, number>();
  const queue = [g.start];
  depth.set(g.start, 0);
  const outs = (n: ServerNode): string[] =>
    n.type === "prompt" || n.type === "browse" || n.type === "sources"
      ? n.next
        ? [n.next]
        : []
      : n.type === "condition"
        ? [n.then, n.else]
        : n.type === "decision"
          ? Object.values(n.choices)
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
    const data: NodeData =
      n.type === "prompt"
        ? { kind: "prompt", botId: n.botId, template: n.template }
        : n.type === "browse"
          ? { kind: "browse", url: n.url }
          : n.type === "decision"
            ? { kind: "decision", question: n.question, choices: Object.keys(n.choices) }
            : n.type === "condition"
              ? { kind: "condition", contains: n.contains }
              : { kind: n.type };
    return { id, type: "zetta", position: pos, data: { ...data, isStart: id === g.start } };
  });
  const edges: Edge[] = [];
  for (const [id, n] of Object.entries(g.nodes)) {
    if (n.type === "prompt" || n.type === "browse" || n.type === "sources") {
      if (n.next)
        edges.push({ id: `${id}:next`, source: id, sourceHandle: "next", target: n.next });
    } else if (n.type === "condition") {
      edges.push(
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
  }
  return { nodes, edges };
}

/** Builds the server graph from the canvas. Unconnected outputs stay unset (the server reports them); conditions/decisions need all branches. */
export function flowToGraph(nodes: FlowNode[], edges: Edge[], start: string): ServerGraph {
  const target = (id: string, handle: string) =>
    edges.find((e) => e.source === id && (e.sourceHandle ?? "next") === handle)?.target;
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
        ...(target(n.id, "next") ? { next: target(n.id, "next")! } : {}),
      };
    else if (d.kind === "browse")
      out[n.id] = {
        type: "browse",
        url: d.url ?? "",
        ...(target(n.id, "next") ? { next: target(n.id, "next")! } : {}),
      };
    else if (d.kind === "sources")
      out[n.id] = {
        type: "sources",
        ...(target(n.id, "next") ? { next: target(n.id, "next")! } : {}),
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
    else out[n.id] = { type: "end" };
  }
  return { start, nodes: out, layout };
}

/** Client-side hints before saving; the server remains the authority (cycles, unreachable steps, bounds). */
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
    if (n.type === "prompt" && !n.botId) p.push(`"${id}" needs a bot.`);
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

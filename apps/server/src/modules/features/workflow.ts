import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const node = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("prompt"),
    botId: z.string().uuid(),
    template: z.string().min(1).max(4000),
    next: id.optional(),
  }),
  // oxlint-disable-next-line unicorn/no-thenable
  z.strictObject({
    type: z.literal("condition"),
    contains: z.string().min(1).max(200),
    // oxlint-disable-next-line unicorn/no-thenable
    then: id,
    else: id,
  }),
  // Laya picks one option from the previous answer; each option routes to a node.
  z.strictObject({
    type: z.literal("decision"),
    question: z.string().min(1).max(300),
    choices: z.record(z.string().min(1).max(80), id),
  }),
  // Reads a public web page with the owner's isolated "workflow" browser profile; the page text becomes the previous answer.
  z.strictObject({
    type: z.literal("browse"),
    url: z.string().url().max(2000),
    next: id.optional(),
  }),
  // Reads the user's followed sources (RSS / web) into labelled text; failing sources are named, never invented.
  z.strictObject({ type: z.literal("sources"), next: id.optional() }),
  z.strictObject({ type: z.literal("end") }),
]);
export type GraphNode = z.infer<typeof node>;
const edgesOf = (n: GraphNode): (string | undefined)[] =>
  n.type === "prompt" || n.type === "browse" || n.type === "sources"
    ? [n.next]
    : n.type === "condition"
      ? [n.then, n.else]
      : n.type === "decision"
        ? Object.values(n.choices)
        : [];

/** Bounded graph: 1-20 nodes, start and every edge must exist, no cycles, no unreachable nodes, a reachable `end` is required. */
// `layout` is presentation only (canvas positions); it never affects execution.
export const graphSchema = z
  .strictObject({
    start: id,
    nodes: z.record(id, node),
    layout: z
      .record(
        id,
        z.object({
          x: z.number().min(-100000).max(100000),
          y: z.number().min(-100000).max(100000),
        }),
      )
      .optional(),
  })
  .superRefine((g, ctx) => {
    const names = Object.keys(g.nodes);
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (names.length === 0 || names.length > 20) issue("A workflow needs 1 to 20 steps.");
    if (!(g.start in g.nodes)) {
      issue("The start step is missing.");
      return;
    }
    for (const [name, n] of Object.entries(g.nodes)) {
      for (const e of edgesOf(n))
        if (e !== undefined && !(e in g.nodes))
          issue(`Step "${name}" points to a step that does not exist.`);
      if (n.type === "decision") {
        const c = Object.keys(n.choices).length;
        if (c < 2 || c > 12) issue(`Decision "${name}" needs 2 to 12 choices.`);
      }
    }
    // Reachability + cycle detection (DFS with colors)
    const color = new Map<string, 1 | 2>();
    let cyclic = false,
      hasEnd = false;
    const visit = (name: string) => {
      if (color.get(name) === 2) return;
      if (color.get(name) === 1) {
        cyclic = true;
        return;
      }
      color.set(name, 1);
      const n = g.nodes[name];
      if (!n) return;
      if (n.type === "end") hasEnd = true;
      for (const e of edgesOf(n)) if (e !== undefined && e in g.nodes) visit(e);
      color.set(name, 2);
    };
    visit(g.start);
    if (cyclic) issue("The workflow loops back on itself.");
    const unreachable = names.filter((n) => !color.has(n));
    if (unreachable.length) issue(`Steps not reachable from the start: ${unreachable.join(", ")}.`);
    if (!hasEnd) issue("The workflow needs a reachable end step.");
  });
export type Graph = z.infer<typeof graphSchema>;
export type TraceStep = {
  node: string;
  type: string;
  botId?: string;
  output?: string;
  branch?: "then" | "else";
  error?: string;
  skipped?: boolean;
};

const MAX_STEPS = 30;
export type Effects = {
  runPrompt: (botId: string, prompt: string) => Promise<string>;
  decide?: (subject: string, question: string, options: string[]) => Promise<string>;
  browse?: (url: string) => Promise<string>;
  sources?: () => Promise<string>;
  /** Called after every step with the trace so far (durable progress). */
  onStep?: (trace: TraceStep[]) => Promise<void> | void;
  signal?: AbortSignal;
};

export async function executeGraph(
  graph: Graph,
  input: string,
  runPromptOrEffects: Effects["runPrompt"] | Effects,
  decideArg?: Effects["decide"],
  browseArg?: Effects["browse"],
) {
  const fx: Effects =
    typeof runPromptOrEffects === "function"
      ? { runPrompt: runPromptOrEffects, decide: decideArg, browse: browseArg }
      : runPromptOrEffects;
  const trace: TraceStep[] = [];
  let current: string | undefined = graph.start,
    prev = input;
  const push = async (s: TraceStep) => {
    trace.push(s);
    await fx.onStep?.(trace);
  };
  for (let steps = 0; current && steps < MAX_STEPS; steps++) {
    if (fx.signal?.aborted) return { status: "cancelled" as const, trace, output: prev };
    const n: GraphNode = graph.nodes[current]!;
    if (n.type === "end") {
      await push({ node: current, type: "end" });
      return { status: "succeeded" as const, trace, output: prev };
    }
    if (n.type === "condition") {
      const hit = prev.toLowerCase().includes(n.contains.toLowerCase());
      await push({ node: current, type: "condition", branch: hit ? "then" : "else" });
      current = hit ? n.then : n.else;
      continue;
    }
    if (n.type === "browse") {
      try {
        if (!fx.browse) throw new Error("no_browser");
        prev = await fx.browse(n.url.replaceAll("{{input}}", input));
        await push({ node: current, type: "browse", output: prev.slice(0, 2000) });
      } catch {
        await push({ node: current, type: "browse", error: "browse_failed" });
        return { status: "failed" as const, trace, output: prev };
      }
      current = n.next;
      continue;
    }
    if (n.type === "sources") {
      try {
        if (!fx.sources) throw new Error("no_sources");
        prev = await fx.sources();
        await push({ node: current, type: "sources", output: prev.slice(0, 2000) });
      } catch {
        await push({ node: current, type: "sources", error: "sources_failed" });
        return { status: "failed" as const, trace, output: prev };
      }
      current = n.next;
      continue;
    }
    if (n.type === "decision") {
      try {
        if (!fx.decide) throw new Error("no_decider");
        const choice = await fx.decide(prev, n.question, Object.keys(n.choices));
        const nextNode: string | undefined = n.choices[choice];
        await push({ node: current, type: "decision", output: choice });
        if (!nextNode) return { status: "failed" as const, trace, output: prev };
        current = nextNode;
      } catch (e) {
        await push({
          node: current,
          type: "decision",
          error:
            (e as Error).name === "DecisionUncertain"
              ? "decision_uncertain"
              : "decision_unavailable",
        });
        return { status: "failed" as const, trace, output: prev };
      }
      continue;
    }
    try {
      prev = await fx.runPrompt(
        n.botId,
        n.template.replaceAll("{{input}}", input).replaceAll("{{prev}}", prev),
      );
      await push({ node: current, type: "prompt", botId: n.botId, output: prev.slice(0, 2000) });
    } catch {
      await push({ node: current, type: "prompt", botId: n.botId, error: "step_failed" });
      return { status: "failed" as const, trace, output: prev };
    }
    current = n.next;
  }
  return { status: current ? ("failed" as const) : ("succeeded" as const), trace, output: prev };
}

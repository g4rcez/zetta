import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_-]{1,32}$/);
/** Tries again after a failure: `max` more tries (never the first one), `delayMs` apart. Only for a failure a second try can fix. */
const retry = z
  .strictObject({
    max: z.number().int().min(1).max(3),
    delayMs: z.number().int().min(0).max(60_000).default(1000),
  })
  .optional();
export const WORKFLOW_MAX_NODES = 30;
export const WORKFLOW_MAX_WAIT_SECONDS = 7 * 86_400;
export const WORKFLOW_MAX_ITEMS = 20;

const node = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("prompt"),
    botId: z.string().uuid(),
    template: z.string().min(1).max(4000),
    next: id.optional(),
    retry,
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
    retry,
  }),
  // Reads the user's followed sources (RSS / web) into labelled text; failing sources are named, never invented.
  z.strictObject({ type: z.literal("sources"), next: id.optional(), retry }),
  // Calls one tool of a plugin, an MCP server, an app or Zetta itself (`zetta`: the target `lessons`, to check what the bots learned), with
  // the grants of `botId` (the same ones the bot has in chat). Arguments are
  // text; a string may hold {{input}}, {{prev}}, {{item}} and {{steps.<id>}}. A tool that changes something must come straight after an
  // `approval` step (checked when the workflow is saved), so the person says yes to that exact call before it runs.
  z.strictObject({
    type: z.literal("tool"),
    botId: z.string().uuid(),
    kind: z.enum(["plugin", "mcp", "app", "zetta"]),
    target: z.string().min(1).max(100),
    tool: z.string().min(1).max(200),
    args: z.record(z.string().min(1).max(80), z.unknown()).optional(),
    next: id.optional(),
    retry,
  }),
  // Stops the run and asks the person (a card in the Inbox). Approving goes on with `next`; declining, or letting the card expire,
  // ends the run as cancelled.
  z.strictObject({
    type: z.literal("approval"),
    message: z.string().min(1).max(500),
    next: id.optional(),
  }),
  // Pauses the run: for `seconds` (up to 7 days), or until the time `until`. The run is kept, so a restart does not lose it.
  z.strictObject({
    type: z.literal("wait"),
    seconds: z.number().int().min(1).max(WORKFLOW_MAX_WAIT_SECONDS).optional(),
    until: z.string().datetime().optional(),
    next: id.optional(),
  }),
  // Runs the steps from `body` once for each item of the previous answer (a line each, or a JSON list), up to 20 items. The body is a
  // chain that ends at an `item_end` step; the answers of all items, numbered, become the previous answer. `{{item}}` is the item.
  z.strictObject({
    type: z.literal("for_each"),
    items: z.enum(["lines", "json"]),
    body: id,
    max: z.number().int().min(1).max(WORKFLOW_MAX_ITEMS).optional(),
    next: id.optional(),
  }),
  // The last step of one pass of a loop body.
  z.strictObject({ type: z.literal("item_end") }),
  z.strictObject({ type: z.literal("end") }),
]);
export type GraphNode = z.infer<typeof node>;
const edgesOf = (n: GraphNode): (string | undefined)[] =>
  n.type === "prompt" ||
  n.type === "browse" ||
  n.type === "sources" ||
  n.type === "tool" ||
  n.type === "approval" ||
  n.type === "wait"
    ? [n.next]
    : n.type === "for_each"
      ? [n.body, n.next]
      : n.type === "condition"
        ? [n.then, n.else]
        : n.type === "decision"
          ? Object.values(n.choices)
          : [];
/** The steps in the order a loop body forbids: a body is plain steps that run to the end of one item. */
const NOT_IN_A_BODY = new Set(["end", "approval", "wait", "for_each"]);

/**
 * Bounded graph: 1-30 nodes, start and every edge must exist, no cycles, no unreachable nodes, a reachable `end` is required. A loop
 * body (`for_each`) is a chain of its own that ends at `item_end`: it holds no `end`, `approval`, `wait` or loop, and is reached only
 * through its loop.
 */
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
    if (names.length === 0 || names.length > WORKFLOW_MAX_NODES)
      issue(`A workflow needs 1 to ${WORKFLOW_MAX_NODES} steps.`);
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
      if (n.type === "wait" && (n.seconds === undefined) === (n.until === undefined))
        issue(`Wait "${name}" needs either a number of seconds or a time to wait until.`);
    }
    // Cycle detection (DFS with colors) over every edge, a loop body included.
    const color = new Map<string, 1 | 2>();
    let cyclic = false;
    const visit = (name: string) => {
      if (color.get(name) === 2) return;
      if (color.get(name) === 1) {
        cyclic = true;
        return;
      }
      color.set(name, 1);
      const n = g.nodes[name];
      if (!n) return;
      for (const e of edgesOf(n)) if (e !== undefined && e in g.nodes) visit(e);
      color.set(name, 2);
    };
    visit(g.start);
    if (cyclic) issue("The workflow loops back on itself.");
    const unreachable = names.filter((n) => !color.has(n));
    if (unreachable.length) issue(`Steps not reachable from the start: ${unreachable.join(", ")}.`);
    if (cyclic) return;

    // What runs outside any loop, and what each loop body holds.
    const reach = (from: string | undefined, edges: (n: GraphNode) => (string | undefined)[]) => {
      const seen = new Set<string>();
      const walk = (name: string | undefined) => {
        if (name === undefined || seen.has(name) || !(name in g.nodes)) return;
        seen.add(name);
        for (const e of edges(g.nodes[name]!)) walk(e);
      };
      walk(from);
      return seen;
    };
    const mainEdges = (n: GraphNode) => (n.type === "for_each" ? [n.next] : edgesOf(n));
    const main = reach(g.start, mainEdges);
    if (![...main].some((n) => g.nodes[n]!.type === "end"))
      issue("The workflow needs a reachable end step.");
    for (const n of main)
      if (g.nodes[n]!.type === "item_end")
        issue(`Step "${n}" ends a loop pass, but it is outside every loop.`);
    const claimed = new Set<string>();
    for (const [name, n] of Object.entries(g.nodes)) {
      if (n.type !== "for_each" || !(n.body in g.nodes)) continue;
      const body = reach(n.body, edgesOf);
      if (![...body].some((b) => g.nodes[b]!.type === "item_end"))
        issue(`The body of loop "${name}" must finish at an "end of item" step.`);
      for (const b of body) {
        const t = g.nodes[b]!.type;
        if (NOT_IN_A_BODY.has(t)) issue(`Step "${b}" (${t}) cannot be inside the loop "${name}".`);
        if (main.has(b)) issue(`Step "${b}" is inside the loop "${name}" and also outside it.`);
        if (claimed.has(b)) issue(`Step "${b}" belongs to two loops.`);
        claimed.add(b);
      }
    }
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
  /** The item of a loop this step ran for (0 is the first). */
  item?: number;
  /** How many tries it took, when it needed more than one. */
  attempts?: number;
};

const MAX_STEPS = 100;
const MAX_KEPT = 20_000;
const OUTPUT_IN_TRACE = 2000;
const OUTPUTS_KEPT = 40;

/** One tool a `tool` step calls, with its arguments already filled in. */
export type ToolCallSpec = {
  botId: string;
  kind: "plugin" | "mcp" | "app" | "zetta";
  target: string;
  tool: string;
  args: Record<string, unknown>;
};
export type Effects = {
  runPrompt: (botId: string, prompt: string) => Promise<string>;
  decide?: (subject: string, question: string, options: string[]) => Promise<string>;
  browse?: (url: string) => Promise<string>;
  sources?: () => Promise<string>;
  /** The answer of the tool, as text. */
  tool?: (call: ToolCallSpec) => Promise<string>;
  /** Called after every step with the trace so far (durable progress). */
  onStep?: (trace: TraceStep[]) => Promise<void> | void;
  signal?: AbortSignal;
  /** Replaces the wait between two tries of a step (tests set it to 0). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** Where a paused run continues: the step to start at (undefined: the flow ended with the wait), what the last step answered, and the answers by step. */
export type Cursor = {
  at: string | undefined;
  prev: string;
  steps: number;
  outputs: Record<string, string>;
};
export type WaitFor =
  | { kind: "time"; node: string; resumeAt: string }
  | { kind: "approval"; node: string; message: string };
export type RunOutcome =
  | { status: "succeeded" | "failed" | "cancelled"; trace: TraceStep[]; output: string }
  | { status: "waiting"; trace: TraceStep[]; output: string; wait: WaitFor; cursor: Cursor };

/** A failure that a second try cannot fix: a sign-in, a limit, a bot that is not ready, a choice nobody could make. */
const NO_RETRY_NAMES = new Set(["DecisionUncertain", "AccessError", "WorkflowError", "AbortError"]);
const NO_RETRY_CODES = new Set([
  "auth_required",
  "not_installed",
  "no_safe_mode",
  "host_refused",
  "workspace_quota",
  "quota",
  "cancelled",
  "BOT_NOT_READY",
]);
export const retryable = (e: unknown) => {
  const x = e as { name?: string; code?: string; message?: string } | undefined;
  return !(
    (x?.name && NO_RETRY_NAMES.has(x.name)) ||
    (x?.code && NO_RETRY_CODES.has(x.code)) ||
    (x?.message && NO_RETRY_CODES.has(x.message))
  );
};
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

/** The items of a loop: one per non-empty line, or the entries of a JSON list (text as it is, anything else as JSON). Undefined when the answer is not that. */
export function loopItems(prev: string, kind: "lines" | "json", max = WORKFLOW_MAX_ITEMS) {
  const cap = Math.min(max, WORKFLOW_MAX_ITEMS);
  if (kind === "lines")
    return prev
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, cap);
  const start = prev.indexOf("[");
  const end = prev.lastIndexOf("]");
  if (start < 0 || end < start) return undefined;
  try {
    const list: unknown = JSON.parse(prev.slice(start, end + 1));
    return Array.isArray(list)
      ? list.slice(0, cap).map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      : undefined;
  } catch {
    return undefined;
  }
}

type Scope = {
  input: string;
  prev: string;
  item?: string | undefined;
  outputs: Record<string, string>;
};
/** Fills {{input}}, {{prev}}, {{item}} and {{steps.<id>}} in one pass, so an answer that holds "{{prev}}" is never filled in again. */
const fill = (text: string, s: Scope) =>
  text.replace(/\{\{(input|prev|item|steps\.[a-z0-9_-]{1,32})\}\}/g, (_m, key: string) =>
    key === "input"
      ? s.input
      : key === "prev"
        ? s.prev
        : key === "item"
          ? (s.item ?? "")
          : (s.outputs[key.slice(6)] ?? ""),
  );
const fillDeep = (value: unknown, s: Scope): unknown =>
  typeof value === "string"
    ? fill(value, s)
    : Array.isArray(value)
      ? value.map((v) => fillDeep(v, s))
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, s)]))
        : value;

export async function executeGraph(
  graph: Graph,
  input: string,
  runPromptOrEffects: Effects["runPrompt"] | Effects,
  decideArg?: Effects["decide"],
  browseArg?: Effects["browse"],
  /** Continue a paused run: its trace so far, and where it stopped. */
  resume?: { trace: TraceStep[]; cursor: Cursor },
): Promise<RunOutcome> {
  const fx: Effects =
    typeof runPromptOrEffects === "function"
      ? { runPrompt: runPromptOrEffects, decide: decideArg, browse: browseArg }
      : runPromptOrEffects;
  const trace: TraceStep[] = resume ? [...resume.trace] : [];
  const outputs: Record<string, string> = resume ? { ...resume.cursor.outputs } : {};
  let current: string | undefined = resume ? resume.cursor.at : graph.start;
  let prev = resume ? resume.cursor.prev : input;
  let steps = resume ? resume.cursor.steps : 0;
  const push = async (s: TraceStep) => {
    trace.push(s);
    await fx.onStep?.(trace);
  };
  const remember = (name: string, text: string) => {
    outputs[name] = text.slice(0, OUTPUT_IN_TRACE);
    const keys = Object.keys(outputs);
    if (keys.length > OUTPUTS_KEPT) delete outputs[keys[0]!];
  };
  const cursor = (at: string | undefined): Cursor => ({
    at,
    prev: prev.slice(0, MAX_KEPT),
    steps,
    outputs,
  });
  const failed = () => ({ status: "failed" as const, trace, output: prev });

  /** Runs `work` and, when the step asks for it, again after a failure a second try can fix. Reports how many tries it took. */
  async function tries<T>(
    n: { retry?: { max: number; delayMs: number } | undefined },
    work: () => Promise<T>,
  ) {
    const more = n.retry?.max ?? 0;
    for (let attempt = 1; ; attempt++) {
      try {
        return { value: await work(), attempts: attempt };
      } catch (e) {
        if (attempt > more || !retryable(e) || fx.signal?.aborted)
          throw Object.assign(e as object, { attempts: attempt });
        await (fx.sleep ?? wait)(n.retry!.delayMs, fx.signal);
      }
    }
  }

  /**
   * One step that does work (not a loop, a wait or an approval): the next step, and the new previous answer. Undefined when the run must
   * stop as failed (the failure is already in the trace).
   */
  async function work(name: string, n: GraphNode, scope: Scope, item?: number) {
    const tag = item === undefined ? {} : { item };
    const out = async (type: string, text: string, extra: Partial<TraceStep> = {}) => {
      remember(name, text);
      await push({ node: name, type, output: text.slice(0, OUTPUT_IN_TRACE), ...extra, ...tag });
    };
    if (n.type === "condition") {
      const hit = scope.prev.toLowerCase().includes(n.contains.toLowerCase());
      await push({ node: name, type: "condition", branch: hit ? "then" : "else", ...tag });
      return { next: hit ? n.then : n.else, prev: scope.prev };
    }
    if (n.type === "decision") {
      try {
        if (!fx.decide) throw new Error("no_decider");
        const choice = await fx.decide(scope.prev, n.question, Object.keys(n.choices));
        const next: string | undefined = n.choices[choice];
        await push({ node: name, type: "decision", output: choice, ...tag });
        return next ? { next, prev: scope.prev } : undefined;
      } catch (e) {
        await push({
          node: name,
          type: "decision",
          error:
            (e as Error).name === "DecisionUncertain"
              ? "decision_uncertain"
              : "decision_unavailable",
          ...tag,
        });
        return undefined;
      }
    }
    if (n.type === "browse") {
      try {
        if (!fx.browse) throw new Error("no_browser");
        const r = await tries(n, () => fx.browse!(n.url.replaceAll("{{input}}", scope.input)));
        await out("browse", r.value, r.attempts > 1 ? { attempts: r.attempts } : {});
        return { next: n.next, prev: r.value };
      } catch (e) {
        await push({
          node: name,
          type: "browse",
          error: "browse_failed",
          ...attemptsOf(e),
          ...tag,
        });
        return undefined;
      }
    }
    if (n.type === "sources") {
      try {
        if (!fx.sources) throw new Error("no_sources");
        const r = await tries(n, () => fx.sources!());
        await out("sources", r.value, r.attempts > 1 ? { attempts: r.attempts } : {});
        return { next: n.next, prev: r.value };
      } catch (e) {
        await push({
          node: name,
          type: "sources",
          error: "sources_failed",
          ...attemptsOf(e),
          ...tag,
        });
        return undefined;
      }
    }
    if (n.type === "tool") {
      try {
        if (!fx.tool) throw new Error("no_tools");
        const call: ToolCallSpec = {
          botId: n.botId,
          kind: n.kind,
          target: n.target,
          tool: n.tool,
          args: fillDeep(n.args ?? {}, scope) as Record<string, unknown>,
        };
        const r = await tries(n, () => fx.tool!(call));
        const text = r.value.slice(0, MAX_KEPT);
        await out("tool", text, {
          botId: n.botId,
          ...(r.attempts > 1 ? { attempts: r.attempts } : {}),
        });
        return { next: n.next, prev: text };
      } catch (e) {
        await push({
          node: name,
          type: "tool",
          botId: n.botId,
          error: "tool_failed",
          ...attemptsOf(e),
          ...tag,
        });
        return undefined;
      }
    }
    if (n.type === "prompt") {
      try {
        const r = await tries(n, () => fx.runPrompt(n.botId, fill(n.template, scope)));
        await out("prompt", r.value, {
          botId: n.botId,
          ...(r.attempts > 1 ? { attempts: r.attempts } : {}),
        });
        return { next: n.next, prev: r.value };
      } catch (e) {
        await push({
          node: name,
          type: "prompt",
          botId: n.botId,
          error: "step_failed",
          ...attemptsOf(e),
          ...tag,
        });
        return undefined;
      }
    }
    // end, item_end, approval, wait and for_each are not work steps: the caller never sends them here.
    return undefined;
  }
  const attemptsOf = (e: unknown) => {
    const a = (e as { attempts?: number } | undefined)?.attempts;
    return a && a > 1 ? { attempts: a } : {};
  };

  if (resume && current === undefined) return { status: "succeeded", trace, output: prev };
  while (current && steps < MAX_STEPS) {
    steps++;
    if (fx.signal?.aborted) return { status: "cancelled", trace, output: prev };
    const name: string = current;
    const n: GraphNode = graph.nodes[name]!;
    if (n.type === "end") {
      await push({ node: name, type: "end" });
      return { status: "succeeded", trace, output: prev };
    }
    if (n.type === "item_end") {
      // Only reached through a loop body; the saved graph cannot lead here from the main flow.
      await push({ node: name, type: "item_end", error: "outside_loop" });
      return failed();
    }
    if (n.type === "wait") {
      const resumeAt = new Date(n.until ?? Date.now() + (n.seconds ?? 0) * 1000);
      await push({ node: name, type: "wait", output: `until ${resumeAt.toISOString()}` });
      return {
        status: "waiting",
        trace,
        output: prev,
        wait: { kind: "time", node: name, resumeAt: resumeAt.toISOString() },
        cursor: cursor(n.next),
      };
    }
    if (n.type === "approval") {
      await push({ node: name, type: "approval", output: n.message.slice(0, OUTPUT_IN_TRACE) });
      return {
        status: "waiting",
        trace,
        output: prev,
        wait: { kind: "approval", node: name, message: n.message },
        cursor: cursor(n.next),
      };
    }
    if (n.type === "for_each") {
      const list = loopItems(prev, n.items, n.max);
      if (!list) {
        await push({ node: name, type: "for_each", error: "items_invalid" });
        return failed();
      }
      const answers: string[] = [];
      for (const [index, item] of list.entries()) {
        let inner: string | undefined = n.body;
        let itemPrev = item;
        while (inner && steps < MAX_STEPS) {
          if (fx.signal?.aborted) return { status: "cancelled", trace, output: prev };
          const step: GraphNode = graph.nodes[inner]!;
          if (step.type === "item_end") break;
          steps++;
          const r = await work(inner, step, { input, prev: itemPrev, item, outputs }, index);
          if (!r) return failed();
          itemPrev = r.prev;
          inner = r.next;
        }
        if (inner && graph.nodes[inner]?.type !== "item_end") {
          await push({ node: name, type: "for_each", error: "too_many_steps" });
          return failed();
        }
        answers.push(itemPrev);
      }
      prev = answers
        .map((a, i) => `[${i + 1}] ${a}`)
        .join("\n\n")
        .slice(0, MAX_KEPT);
      remember(name, prev);
      await push({
        node: name,
        type: "for_each",
        output: `${list.length} item${list.length === 1 ? "" : "s"}`,
      });
      current = n.next;
      continue;
    }
    const r = await work(name, n, { input, prev, outputs }, undefined);
    if (!r) return failed();
    prev = r.prev;
    current = r.next;
  }
  return { status: current ? "failed" : "succeeded", trace, output: prev };
}

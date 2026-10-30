/** Pure conversion between the step builder and the server's bounded workflow graph. */
export type Step =
  | { kind: "prompt"; botId: string; template: string }
  | { kind: "browse"; url: string }
  | { kind: "decision"; question: string; options: string; continueOn: string }
  | { kind: "condition"; contains: string };

export type GraphNode =
  | { type: "prompt"; botId: string; template: string; next?: string }
  | { type: "browse"; url: string; next?: string }
  | { type: "decision"; question: string; choices: Record<string, string> }
  | { type: "condition"; contains: string; then: string; else: string }
  | { type: "end" };
export type Graph = { start: string; nodes: Record<string, GraphNode> };

export const splitOptions = (s: string) =>
  s
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

/** Steps run top to bottom. A decision continues only on its "continue" option; a condition continues only when the previous answer contains the text; anything else stops. */
export function stepsToGraph(steps: Step[]): Graph {
  const nodes: Record<string, GraphNode> = {};
  const nextOf = (i: number) => (i < steps.length - 1 ? `s${i + 1}` : "end");
  let needsStop = false;
  steps.forEach((s, i) => {
    const key = `s${i}`;
    if (s.kind === "prompt")
      nodes[key] = { type: "prompt", botId: s.botId, template: s.template, next: nextOf(i) };
    else if (s.kind === "browse") nodes[key] = { type: "browse", url: s.url, next: nextOf(i) };
    // oxlint-disable-next-line unicorn/no-thenable
    else if (s.kind === "condition") {
      needsStop = true;
      // oxlint-disable-next-line unicorn/no-thenable
      nodes[key] = { type: "condition", contains: s.contains, then: nextOf(i), else: "stop" };
    } else {
      needsStop = true;
      nodes[key] = {
        type: "decision",
        question: s.question,
        choices: Object.fromEntries(
          splitOptions(s.options).map((o) => [o, o === s.continueOn ? nextOf(i) : "stop"]),
        ),
      };
    }
  });
  nodes.end = { type: "end" };
  if (needsStop) nodes.stop = { type: "end" };
  return { start: "s0", nodes };
}

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/** Reads a graph back into steps. Returns null unless the graph is exactly what the builder would produce. */
export function graphToSteps(graph: unknown): Step[] | null {
  const g = graph as Graph | null;
  if (
    !g ||
    typeof g !== "object" ||
    typeof g.start !== "string" ||
    !g.nodes ||
    typeof g.nodes !== "object"
  )
    return null;
  const steps: Step[] = [];
  let cur: string | undefined = g.start;
  for (let guard = 0; cur && guard < 25; guard++) {
    const n: GraphNode | undefined = g.nodes[cur];
    if (!n) return null;
    if (n.type === "end") break;
    if (n.type === "prompt") {
      steps.push({ kind: "prompt", botId: n.botId, template: n.template });
      cur = n.next;
    } else if (n.type === "browse") {
      steps.push({ kind: "browse", url: n.url });
      cur = n.next;
    } else if (n.type === "condition") {
      steps.push({ kind: "condition", contains: n.contains });
      cur = n.then;
    } else if (n.type === "decision") {
      const forward = new Set(Object.values(n.choices).filter((t) => t !== "stop"));
      const keys = Object.keys(n.choices).filter((k) => n.choices[k] !== "stop");
      if (forward.size !== 1 || keys.length !== 1) return null;
      steps.push({
        kind: "decision",
        question: n.question,
        options: Object.keys(n.choices).join(", "),
        continueOn: keys[0]!,
      });
      cur = [...forward][0];
    } else return null;
  }
  if (steps.length === 0) return null;
  return canonical(stepsToGraph(steps)) === canonical(g) ? steps : null;
}

import { Laya, type Question } from "@receptron/laya";

export type DecisionState = "idle" | "loading" | "ready" | "failed";
export type DecisionQuestions = Record<string, Question>;
export class DecisionError extends Error { constructor(readonly code: "timeout" | "invalid_output" | "unavailable") { super(code); } }

export type Choice = { choice: string | null; uncertain: boolean; probabilities: Record<string, number>; confidence: number; provenance: { model: "laya" | "jev"; at: string; ms: number } };
type Model = Pick<Laya, "systemOne" | "close">;
const DEADLINE_MS = 30_000;

/**
 * Builtin, free, local System-1 decision model (Laya, Jev-compatible, ONNX on CPU). Zetta does not implement its own
 * decision engine: it loads the model lazily, serializes calls under a deadline, validates every output and reports status.
 * A call that exceeds the deadline releases the queue and discards the model so the next call starts clean.
 * Weights (~1.7GB) are cached by the package under ~/.cache/receptron-laya the first time they are needed.
 */
export function createDecisionService(load: () => Promise<Model> = () => Laya.load(), deadlineMs = DEADLINE_MS, caps: { queue?: number; perOwner?: number } = {}) {
  const maxQueue = caps.queue ?? 32, maxPerOwner = caps.perOwner ?? 4;
  let pending = 0; const owners = new Map<string, number>();
  let state: DecisionState = "idle";
  let model: Promise<Model> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  function warm() {
    if (!model) {
      state = "loading";
      model = load().then((m) => { state = "ready"; return m; }, (e) => { state = "failed"; model = undefined; throw e; });
    }
    return model;
  }
  function withDeadline<T>(p: Promise<T>) {
    let timer: ReturnType<typeof setTimeout>;
    const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new DecisionError("timeout")), deadlineMs); });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
  }
  const svc = {
    status: () => ({ state, model: "laya" as const }),
    warm: () => warm().then(() => undefined, () => undefined),
    /** Calls are serialized: one ONNX session, bounded memory. */
    decide(subject: Record<string, unknown> | string, questions: DecisionQuestions, owner?: string) {
      // Bounded backlog: one ONNX session serves everyone, so a flood from one user (or in total) fails fast instead of piling up memory and latency.
      if (pending >= maxQueue || (owner && (owners.get(owner) ?? 0) >= maxPerOwner)) return Promise.reject(new DecisionError("unavailable"));
      pending++; if (owner) owners.set(owner, (owners.get(owner) ?? 0) + 1);
      const release = () => { pending--; if (owner) { const n = (owners.get(owner) ?? 1) - 1; if (n <= 0) owners.delete(owner); else owners.set(owner, n); } };
      const run = queue.then(async () => {
        try { return await withDeadline((async () => (await warm()).systemOne(subject as never, questions as never))()); }
        catch (e) {
          if (e instanceof DecisionError && e.code === "timeout") { const dead = model; model = undefined; state = "idle"; void dead?.then((m) => m.close()).catch(() => {}); }
          throw e;
        }
      });
      queue = run.then(release, release).then(() => undefined);
      return run;
    },
    /** Picks one option. Output is validated (choice among options, probabilities sum ~1); below `minConfidence` the result is "uncertain". */
    async choose(subject: string, instructions: string, options: readonly string[], opts: { minConfidence?: number; descriptions?: Record<string, string>; owner?: string } = {}): Promise<Choice> {
      const started = Date.now();
      const criteria = Object.fromEntries(options.map((o) => [o, opts.descriptions?.[o] ?? o]));
      let result;
      try { result = await svc.decide(subject, { pick: { type: "choice", instructions, criteria } }, opts.owner); }
      catch (e) { throw e instanceof DecisionError ? e : new DecisionError("unavailable"); }
      const answer = (result.answers as Record<string, unknown>).pick as { choice?: unknown; probabilities?: Record<string, number> } | undefined;
      const probs = answer?.probabilities ?? {};
      const sum = Object.values(probs).reduce((a, b) => a + (typeof b === "number" && Number.isFinite(b) ? b : NaN), 0);
      if (!answer || typeof answer.choice !== "string" || !options.includes(answer.choice) || !(Math.abs(sum - 1) < 0.05) || Object.keys(probs).some((k) => !options.includes(k))) throw new DecisionError("invalid_output");
      const confidence = probs[answer.choice] ?? 0;
      const uncertain = confidence < (opts.minConfidence ?? 0);
      return { choice: uncertain ? null : answer.choice, uncertain, probabilities: probs, confidence, provenance: { model: "laya", at: new Date().toISOString(), ms: Date.now() - started } };
    },
    async close() { if (model) (await model.catch(() => undefined))?.close(); model = undefined; state = "idle"; },
  };
  return svc;
}
export type DecisionService = ReturnType<typeof createDecisionService>;

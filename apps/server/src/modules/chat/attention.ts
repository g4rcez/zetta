import type { DecisionService } from "../decisions/service";

/** How much work a message asks for, read by the builtin Laya model before the AI is called. */
export type Attention = {
  level: "trivial" | "normal" | "complex";
  /** Expected level on the 4-step rubric, 0..3. */
  score: number;
  /** Probability of the reported answer, 0..1. */
  confidence: number;
  ms: number;
};

const QUESTION = {
  attention: {
    type: "score",
    instructions: "How much work does this message ask an assistant to do?",
    criteria: [
      "a greeting, thanks, or a short acknowledgement",
      "a simple question or one small action",
      "a task with several steps or several sources",
      "a long, complex or high-stakes task that needs a plan and checks",
    ],
  },
} as const;

// A wrong "trivial" costs the answer its documents and memory items, so that class needs the most confidence.
export const TRIVIAL_BELOW = 0.5;
export const TRIVIAL_MIN_CONFIDENCE = 0.7;
export const COMPLEX_FROM = 2.4;
export const COMPLEX_MIN_CONFIDENCE = 0.5;
/** The longest a turn waits for the model. Past it, the turn runs as if Laya were off. */
const GUARD_MS = 1500;

export function levelOf(score: number, confidence: number): Attention["level"] {
  if (score < TRIVIAL_BELOW && confidence >= TRIVIAL_MIN_CONFIDENCE) return "trivial";
  if (score >= COMPLEX_FROM && confidence >= COMPLEX_MIN_CONFIDENCE) return "complex";
  return "normal";
}

/**
 * Result is `undefined` when Laya is off, still loading, busy, slow or wrong: the turn then runs exactly as it did before.
 * It never waits for a model download or load.
 */
export function createAttention(
  decisions?: Pick<DecisionService, "status" | "decide">,
  guardMs = GUARD_MS,
) {
  return {
    async assess(text: string, owner: string): Promise<Attention | undefined> {
      if (!decisions || decisions.status().state !== "ready") return undefined;
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const slow = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("slow")), guardMs);
        });
        const r = await Promise.race([decisions.decide(text, QUESTION as never, owner), slow]);
        const a = (r.answers as Record<string, unknown>).attention as
          | { score?: unknown; answer_confidence?: unknown }
          | undefined;
        const score = a?.score;
        const confidence = a?.answer_confidence;
        if (
          typeof score !== "number" ||
          typeof confidence !== "number" ||
          !Number.isFinite(score) ||
          !Number.isFinite(confidence)
        )
          return undefined;
        return { level: levelOf(score, confidence), score, confidence, ms: Date.now() - started };
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export type AttentionService = ReturnType<typeof createAttention>;

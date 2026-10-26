import { z } from "zod";
import type { ActiveActor } from "../identity/access";
import { DecisionError, type Choice } from "./service";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";
const MAX_BODY = 32 * 1024, MAX_RESPONSE = 64 * 1024, DEADLINE_MS = 10_000;

/** Strict response shape per docs/decisions/jev-laya.md: one choice answer with probabilities over exactly the offered options. */
const responseSchema = z.object({
  model: z.string().min(1).max(64),
  answers: z.record(z.string(), z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number().min(0).max(1)), confidence: z.number().min(0).max(1) })),
  usage: z.object({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) }).optional(),
});

export type JevOptions = { fetch?: typeof fetch; endpoint?: string; model?: string; deadlineMs?: number };

/**
 * Typesafe Jev System One adapter (optional backend, `decision_config.backend = "jev"`). Fixed HTTPS origin, no redirects, no
 * environment/admin credential fallback: the key is the requesting user's own `jev` connection, resolved at call time. Only the
 * supplied message text and the option labels leave the server. Output is validated; no retries; late results are ignored.
 */
export function createJevDecider(resolveKey: (actor: ActiveActor) => Promise<Buffer>, opts: JevOptions = {}) {
  const doFetch = opts.fetch ?? fetch, endpoint = opts.endpoint ?? JEV_ENDPOINT, model = opts.model ?? JEV_MODEL;
  return {
    async choose(actor: ActiveActor, subject: string, instructions: string, options: readonly string[], o: { minConfidence?: number; descriptions?: Record<string, string> } = {}): Promise<Choice> {
      const started = Date.now();
      const body = JSON.stringify({ model, state: subject.slice(0, 8000), questions: { pick: { type: "choice", instructions: instructions.slice(0, 300), criteria: Object.fromEntries(options.map((x) => [x, o.descriptions?.[x] ?? x])) } } });
      if (Buffer.byteLength(body) > MAX_BODY) throw new DecisionError("invalid_output");
      let key: Buffer;
      try { key = await resolveKey(actor); } catch { throw new DecisionError("unavailable"); }
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.deadlineMs ?? DEADLINE_MS);
      try {
        const res = await doFetch(endpoint, { method: "POST", redirect: "error", signal: ctl.signal, headers: { "content-type": "application/json", authorization: `Bearer ${key.toString("utf8")}` }, body }).catch((e) => { throw new DecisionError(e?.name === "AbortError" ? "timeout" : "unavailable"); });
        if (!res.ok) throw new DecisionError("unavailable");
        const raw = await res.text();
        if (raw.length > MAX_RESPONSE) throw new DecisionError("invalid_output");
        let json: unknown; try { json = JSON.parse(raw); } catch { throw new DecisionError("invalid_output"); }
        const parsed = responseSchema.safeParse(json);
        const a = parsed.success ? parsed.data.answers.pick : undefined;
        if (!parsed.success || !a || parsed.data.model !== model) throw new DecisionError("invalid_output");
        const keys = Object.keys(a.probabilities);
        const max = Math.max(...Object.values(a.probabilities));
        const sum = Object.values(a.probabilities).reduce((x, y) => x + y, 0);
        if (!options.includes(a.choice) || keys.length !== options.length || keys.some((k) => !options.includes(k)) || Math.abs(sum - 1) > 0.02 || (a.probabilities[a.choice] ?? -1) < max - 1e-9) throw new DecisionError("invalid_output");
        const confidence = a.probabilities[a.choice]!;
        const uncertain = confidence < (o.minConfidence ?? 0);
        return { choice: uncertain ? null : a.choice, uncertain, probabilities: a.probabilities, confidence, provenance: { model: "jev", at: new Date().toISOString(), ms: Date.now() - started } };
      } finally { clearTimeout(timer); key.fill(0); }
    },
  };
}
export type JevDecider = ReturnType<typeof createJevDecider>;

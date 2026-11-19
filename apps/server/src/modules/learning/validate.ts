import { BATCH_MAX_CANDIDATES, LESSON_MAX_CHARS } from "@zetta/core/learning";
import { z } from "zod";
import { unsafeMemory } from "../features/knowledge";
import { looksSecret } from "../features/safety";
import { saidOutright, tokens } from "./text";

/**
 * The checks a candidate lesson passes before it is used, none of which asks a model (docs/decisions/lessons.md): every quote must be
 * the person's own words, found in a message of theirs that this pass read; the text must not read as an instruction aimed at an AI or
 * hold a secret; and "said outright" is read from their message, never from what the model says they meant. Pure.
 */

/** A message the daily pass showed the model, by the short reference the model used for it (`#12`). */
export type PassMessage = {
  ref: string;
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  /** The day it was written (UTC, YYYY-MM-DD). */
  day: string;
  /** May its words be quoted as the person's own: their message, finished, with nothing attached or quoted from elsewhere. */
  eligible: boolean;
};

export const candidateSchema = z.object({
  /** A lesson or candidate the model was shown (`L2`): the same one seen again. */
  id: z.string().trim().max(12).optional(),
  text: z.string().trim().min(1).max(2000),
  kind: z.enum(["rule", "procedure"]).default("rule"),
  scope: z.enum(["topic", "always"]).default("topic"),
  topic: z.string().trim().max(60).default(""),
  evidence: z
    .array(z.object({ ref: z.string().trim().max(12), quote: z.string().trim().max(600) }))
    .max(6)
    .default([]),
});
export type Candidate = z.infer<typeof candidateSchema>;

/** What the model answered, with everything that is not a well-formed candidate dropped, and at most `BATCH_MAX_CANDIDATES` kept. */
export function parseCandidates(raw: unknown): Candidate[] {
  const list = (raw as { candidates?: unknown } | null | undefined)?.candidates;
  if (!Array.isArray(list)) return [];
  const out: Candidate[] = [];
  for (const item of list) {
    const c = candidateSchema.safeParse(item);
    if (c.success) out.push(c.data);
    if (out.length >= BATCH_MAX_CANDIDATES) break;
  }
  return out;
}

const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** What the person wrote themselves: no fenced code (pasted from elsewhere), no quoted lines (a blockquote is somebody else's text). */
export function ownWords(content: string): string {
  return content
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

/**
 * The sentence a quote is in, and nothing else: where a person says "from now on…". Only that sentence, so a polite "always a pleasure" in
 * the one before cannot turn a passing remark into a rule. Empty when the quote is not found.
 */
export function sentenceAround(content: string, quote: string): string {
  const q = norm(quote);
  const sentences = ownWords(content).split(/(?<=[.!?])\s+|\n+/);
  const at = sentences.findIndex((s) => norm(s).includes(q));
  return at < 0 ? "" : sentences[at]!;
}

export type Evidence = {
  messageId: string;
  conversationId: string;
  quote: string;
  day: string;
  /** The person's own sentence states a rule outright ("from now on…", "always…"). */
  said: boolean;
};

export type Verdict =
  | {
      ok: true;
      text: string;
      topic: string;
      kind: "rule" | "procedure";
      scope: "topic" | "always";
      evidence: Evidence[];
      /** At least one quote is from a sentence where the person stated the rule outright. */
      said: boolean;
    }
  | { ok: false; reason: string };

/** The evidence of a candidate that stands, and why the others do not. */
export function checkEvidence(
  c: Pick<Candidate, "evidence">,
  messages: ReadonlyMap<string, PassMessage>,
): { kept: Evidence[]; refused: string[] } {
  const kept: Evidence[] = [];
  const refused: string[] = [];
  for (const e of c.evidence) {
    const m = messages.get(e.ref);
    if (!m) refused.push(`${e.ref}: no such message`);
    else if (!m.eligible) refused.push(`${e.ref}: not the person's own words`);
    else if (tokens(e.quote).length < 2 || norm(e.quote).length < 8)
      refused.push(`${e.ref}: quote too short`);
    else if (!norm(ownWords(m.content)).includes(norm(e.quote)))
      refused.push(`${e.ref}: not in their message, or only inside code or a quotation`);
    else if (!kept.some((k) => k.messageId === m.id))
      kept.push({
        messageId: m.id,
        conversationId: m.conversationId,
        quote: e.quote.replace(/\s+/g, " ").trim(),
        day: m.day,
        said: saidOutright(sentenceAround(m.content, e.quote)),
      });
  }
  return { kept, refused };
}

/** All the checks: the text, then the evidence. */
export function validateCandidate(
  c: Candidate,
  messages: ReadonlyMap<string, PassMessage>,
): Verdict {
  const text = c.text.replace(/\s+/g, " ").trim();
  if (c.kind === "rule" && text.length > LESSON_MAX_CHARS)
    return {
      ok: false,
      reason: `longer than ${LESSON_MAX_CHARS} characters: it is a procedure, not a rule`,
    };
  if (unsafeMemory(text)) return { ok: false, reason: "reads as an instruction aimed at an AI" };
  if (looksSecret(text)) return { ok: false, reason: "looks like a secret" };
  const { kept, refused } = checkEvidence(c, messages);
  if (!kept.length)
    return {
      ok: false,
      reason: refused.length
        ? `no evidence stands (${refused.slice(0, 2).join("; ")})`
        : "no evidence from the person's own words",
    };
  return {
    ok: true,
    text,
    topic: c.topic,
    kind: c.kind,
    scope: c.scope,
    evidence: kept,
    said: kept.some((e) => e.said),
  };
}

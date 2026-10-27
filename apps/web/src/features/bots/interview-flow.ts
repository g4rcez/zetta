import { composeInstructions, type Brief } from "./instruction-review";

/** The fixed questions used when the engine can't write the draft: each answer fills one slot of the template. */
export const TEMPLATE_QUESTIONS: { key: keyof Brief; question: string; suggestions: string[] }[] = [
  {
    key: "job",
    question: "What is its job, in one sentence?",
    suggestions: ["Turn merged pull requests into customer-facing release notes"],
  },
  { key: "steps", question: "What should it do, step by step? (one per line)", suggestions: [] },
  {
    key: "output",
    question: "What does a great answer look like?",
    suggestions: ["A short summary, then a bulleted list, under 200 words"],
  },
  {
    key: "never",
    question: "What must it never do?",
    suggestions: ["Share private details or guess when it isn't sure"],
  },
  {
    key: "ask",
    question: "When should it stop and ask you?",
    suggestions: ["The request is unclear or could not be undone"],
  },
];

export type Turn = { question: string; answer: string };
export type InterviewState = {
  turns: Turn[];
  current: { question: string; suggestions: string[] } | null;
  source: "engine" | "template";
  /** Why the engine was skipped, shown once above the basic questions. */
  notice: string | null;
  status: "idle" | "thinking";
  error: string | null;
  /** The person chose to write it by hand: the interview never starts. */
  manual: boolean;
  /** A draft is in place; the conversation moves on to refining it. */
  drafted: boolean;
  /** What the person asked to change after the draft, in order. */
  changes: string[];
  /** The engine's plain-language list of what the bot will do. */
  summary: string[];
};
export const FRESH_INTERVIEW: InterviewState = {
  turns: [],
  current: null,
  source: "engine",
  notice: null,
  status: "idle",
  error: null,
  manual: false,
  drafted: false,
  changes: [],
  summary: [],
};

export function briefFromTurns(turns: Turn[]): Brief {
  const brief: Brief = { job: "", steps: "", output: "", never: "", ask: "" };
  turns.forEach((t, i) => {
    const slot = TEMPLATE_QUESTIONS[i];
    if (slot) brief[slot.key] = t.answer;
  });
  return brief;
}

/** The next basic question, or the finished template text once all five are answered. */
export function nextTemplateStep(
  turns: Turn[],
): { done: false; question: string; suggestions: string[] } | { done: true; instructions: string } {
  const slot = TEMPLATE_QUESTIONS[turns.length];
  return slot
    ? { done: false, question: slot.question, suggestions: slot.suggestions }
    : { done: true, instructions: composeInstructions(briefFromTurns(turns)) };
}

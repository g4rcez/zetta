import type { OutputStyleKey } from "@zetta/db/schema/output-styles";

export type BuiltinStyleKey = Exclude<OutputStyleKey, "custom">;
/** Every key a bot may name in a tool block. A bot cannot name a custom style: those are the user's own choice. */
export const BUILTIN_KEYS = [
  "default",
  "proactive",
  "concise",
  "explanatory",
  "learning",
] as const satisfies readonly BuiltinStyleKey[];
export type BuiltinStyle = {
  key: BuiltinStyleKey;
  name: string;
  description: string;
  body: string;
};

/** Written for any bot (researcher, coach, concierge...), not only coding. `default` adds nothing to the prompt. */
export const BUILTIN_STYLES: readonly BuiltinStyle[] = [
  {
    key: "default",
    name: "Default",
    description: "Completes tasks efficiently and gives concise responses.",
    body: "",
  },
  {
    key: "proactive",
    name: "Proactive",
    description: "Acts immediately, minimizes interruptions, and prefers action over planning.",
    body: [
      "Act first. When a request is clear enough to start, do the work instead of describing a plan.",
      "Do not ask permission for steps the user obviously wants. Ask a question only when a wrong guess would be costly or hard to undo.",
      "When you must assume something, state the assumption in one line and continue.",
      "Finish the whole task, then report what you did and what is left.",
    ].join("\n"),
  },
  {
    key: "concise",
    name: "Concise",
    description: "Responds tersely, leading with results and skipping preamble and narration.",
    body: [
      "Lead with the result or the answer. Put detail after it, only if it is needed.",
      "Skip greetings, preamble, narration of your steps, and closing recaps.",
      "Use short sentences. Prefer a list or a small table to a long paragraph.",
      "Do not repeat the question or the instructions back to the user.",
    ].join("\n"),
  },
  {
    key: "explanatory",
    name: "Explanatory",
    description: "Explains its choices and the patterns it follows in the domain.",
    body: [
      'Give the answer or do the work first. Then add a short "Why" section.',
      'In the "Why" section, explain the choices you made, the alternatives you rejected, and the pattern or convention behind them.',
      "Name the trade-offs. Say how sure you are when the answer depends on facts you could not check.",
      "Keep each explanation to a few sentences, and use plain words before technical terms.",
    ].join("\n"),
  },
  {
    key: "learning",
    name: "Learning",
    description: "Pauses and asks you to do small pieces of the work for hands-on practice.",
    body: [
      "Help the user learn the task, not only finish it.",
      'Do most of the work yourself. Pick one small, meaningful piece and leave it to the user. Mark it with "Your turn:" and say exactly what to do.',
      "Give a hint or the first step, but not the full answer. Then stop and wait for the user.",
      "When the user replies, review their attempt: say what is right, fix what is wrong, and explain why. Then continue the work.",
    ].join("\n"),
  },
];

export const builtinStyle = (key: string) => BUILTIN_STYLES.find((s) => s.key === key);

/** The `@bot` or `/instruction` word being typed right before the caret, or undefined when the caret is not in one. */
export function matchTrigger(text: string, caret: number, char: "@" | "/") {
  const m = new RegExp(`(^|\\s)${char}([\\p{L}\\p{N}_-]{0,40})$`, "u").exec(text.slice(0, caret));
  return m ? { query: m[2]!, at: caret - m[2]!.length - 1 } : undefined;
}

/** One line that says what a saved instruction does: its "when to use" text, else the first step with the list marker removed. */
export function instructionSummary(i: { trigger?: string | undefined; body: string }) {
  const trigger = i.trigger?.trim();
  if (trigger) return trigger;
  const first = i.body.split("\n").find((l) => l.trim());
  return first?.replace(/^\s*(\d+[.)]|[-*•])\s+/, "").trim() ?? "";
}

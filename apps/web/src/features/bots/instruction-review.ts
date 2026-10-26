/** One quality check on a bot's personality + instructions. `fix` tells the author what to add when the check fails. */
export type InstructionCheck = { id: string; label: string; ok: boolean; why: string; fix: string };

/** Answers to the onboarding's guided questions; `composeInstructions` turns them into an instructions draft. */
export type Brief = { job: string; steps: string; output: string; never: string; ask: string };
export const EMPTY_BRIEF: Brief = { job: "", steps: "", output: "", never: "", ask: "" };

const VAGUE = /\b(be helpful|do your best|as needed|be nice|be smart|good job|whatever works|and so on|etc\.?)(?=\W|$)/i;

/**
 * Heuristic review of what a bot is told to do. It never blocks creation: it only shows what is already good and what would make the
 * bot more predictable. Kept deterministic (no model call) so it runs on every keystroke.
 */
export function reviewInstructions(personality: string, instructions: string): InstructionCheck[] {
  const all = `${personality}\n${instructions}`;
  const len = instructions.trim().length;
  const vague = all.match(VAGUE)?.[0];
  return [
    { id: "role", label: "Has a clear role", ok: /\byou are\b|\byour (job|role)\b|\bact as\b/i.test(all) || personality.trim().length >= 40,
      why: "A one-line role anchors tone and expertise for every answer.", fix: "Start the personality with \"You are a …\" and the kind of expert it is." },
    { id: "length", label: len > 6000 ? "Focused (not too long)" : "Specific enough", ok: len >= 120 && len <= 6000,
      why: "Short instructions leave the bot guessing; very long ones bury the important rules.", fix: len > 6000 ? "Trim repeated rules and keep the ones that change behaviour." : "Describe the job in a few sentences: what it receives and what it should do." },
    { id: "steps", label: "Describes how to work", ok: /^\s*(\d+[.)]|[-*•])\s/m.test(instructions) || /\b(first|then|next|start by|before|after|finally|step)\b/i.test(instructions),
      why: "Ordered steps make the bot's behaviour repeatable.", fix: "Add the steps it should follow, e.g. \"Start by …, then …, finally …\"." },
    { id: "output", label: "Says what a good answer looks like", ok: /\b(format|table|list|bullet|summary|summari[sz]e|markdown|code block|fenced|reply with|respond with|return|end with|one line|paragraph)/i.test(instructions),
      why: "Naming the shape of the answer avoids walls of text.", fix: "Say how to answer: a short summary, a table, a list, code blocks…" },
    { id: "boundaries", label: "Sets boundaries", ok: /\b(never|don't|do not|avoid|must not|only|without)\b/i.test(all),
      why: "Boundaries stop the bot from doing things you didn't want.", fix: "Add at least one rule of what it must never do." },
    { id: "ask", label: "Knows when to ask", ok: /\b(ask|clarify|confirm|unsure|unclear|under-specified|missing|not sure)\b/i.test(all),
      why: "A bot that asks when unsure makes fewer confident mistakes.", fix: "Tell it when to stop and ask, e.g. \"If the request is unclear, ask one question first.\"" },
    { id: "vague", label: "Avoids vague filler", ok: !vague,
      why: "Phrases like \"be helpful\" don't change behaviour and dilute the real rules.", fix: vague ? `Replace "${vague.trim()}" with a concrete rule.` : "" },
  ];
}

/** Score in [0, 100] for the progress meter. */
export const reviewScore = (checks: InstructionCheck[]) => (checks.length ? Math.round((checks.filter((c) => c.ok).length / checks.length) * 100) : 0);

/** The concrete actions the bot will take, as read back from the instructions: one per list item or sentence. */
export function extractActions(instructions: string): string[] {
  return instructions
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((s) => s.length >= 8)
    .slice(0, 12);
}

/** Builds an instructions draft from the guided questions; empty answers are skipped. */
export function composeInstructions(b: Brief): string {
  const lines = [
    b.job.trim() && `Your job: ${b.job.trim().replace(/\.?$/, ".")}`,
    b.steps.trim() && `How to work:\n${b.steps.trim().split(/\n+/).map((s, i) => `${i + 1}. ${s.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()}`).join("\n")}`,
    b.output.trim() && `How to answer: ${b.output.trim().replace(/\.?$/, ".")}`,
    b.never.trim() && `Never: ${b.never.trim().replace(/\.?$/, ".")}`,
    b.ask.trim() && `Ask before acting when: ${b.ask.trim().replace(/\.?$/, ".")}`,
  ].filter(Boolean);
  return lines.join("\n\n");
}

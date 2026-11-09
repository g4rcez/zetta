import { splitReply, UI_FENCE } from "@zetta/render/reply";

const MAX_CODES = 10;

/**
 * What the catalog dropped from the `zetta:ui` blocks of a finished reply, as short codes (`invalid_props:Chart:chart.series`).
 * Names and paths only, never values: the text came from a model and may hold anything. Empty when every block validated.
 */
export function uiIssueCodes(text: string): string[] {
  if (!text.includes("```" + UI_FENCE)) return [];
  const codes = new Set<string>();
  for (const seg of splitReply(text))
    if (seg.kind === "ui" && seg.complete)
      for (const i of seg.issues) codes.add([i.code, i.type, i.path].filter(Boolean).join(":"));
  return [...codes].slice(0, MAX_CODES);
}

/** One warning line per reply with dropped parts, so bots that misuse the catalog show up in the server log. Never reaches the user and never triggers a rerun. */
export function logUiIssues(botId: string, text: string) {
  const codes = uiIssueCodes(text);
  if (codes.length) console.warn(`zetta:ui dropped bot=${botId} ${codes.join(" ")}`);
}

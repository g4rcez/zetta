/** The `@bot`, `#team` or `/memory-item` word being typed right before the caret, or undefined when the caret is not in one. */
export function matchTrigger(text: string, caret: number, char: "@" | "#" | "/") {
  const m = new RegExp(`(^|\\s)${char}([\\p{L}\\p{N}_-]{0,40})$`, "u").exec(text.slice(0, caret));
  return m ? { query: m[2]!, at: caret - m[2]!.length - 1 } : undefined;
}

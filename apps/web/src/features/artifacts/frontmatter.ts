/** One `key: value` line of a Markdown file's frontmatter. */
export type FrontmatterField = { key: string; value: string };

/**
 * Splits a Markdown file into its YAML frontmatter (the `---` block at the very top) and the body.
 * Reads what a SKILL.md or agent file uses: `key: value`, quoted values, `>` and `|` blocks, and indented continuation lines.
 * Anything that is not a frontmatter block returns no fields and the text unchanged.
 */
export function splitFrontmatter(text: string): { fields: FrontmatterField[]; body: string } {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fields: [], body: text };
  const fields: FrontmatterField[] = [];
  let current: { key: string; lines: string[]; block: string } | undefined;
  const flush = () => {
    if (!current) return;
    const folded = current.block === ">" || current.block === "";
    const joined = folded ? current.lines.join(" ") : current.lines.join("\n");
    fields.push({ key: current.key, value: joined.trim().replace(/^(["'])([\s\S]*)\1$/, "$2") });
    current = undefined;
  };
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line);
    if (kv) {
      flush();
      const rest = kv[2]!.trim();
      const block = /^[>|][+-]?$/.test(rest) ? rest[0]! : "";
      current = { key: kv[1]!, lines: block ? [] : rest ? [rest] : [], block };
    } else if (current && /^\s+\S/.test(line)) current.lines.push(line.trim());
  }
  flush();
  if (!fields.length) return { fields: [], body: text };
  return { fields, body: text.slice(m[0].length).replace(/^\s*\r?\n/, "") };
}

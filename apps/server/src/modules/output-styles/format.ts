/** Limits shared by the routes, the importer and the database checks. */
export const STYLE_LIMITS = {
  name: 60,
  description: 280,
  body: 8192,
  file: 16384,
  perOwner: 200,
} as const;

export type StyleDoc = { name: string; description: string; body: string };

export class StyleFormatError extends Error {
  constructor(readonly reason: "INVALID" | "TOO_LONG" | "BAD_FILE") {
    super(reason);
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The Claude Code output-style file: `---` frontmatter with `name` and `description`, then the instructions. */
export function toMarkdown({ name, description, body }: StyleDoc): string {
  return `---\nname: ${JSON.stringify(oneLine(name))}\ndescription: ${JSON.stringify(oneLine(description))}\n---\n\n${body.trim()}\n`;
}

function value(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Not a JSON string: keep the text as written.
    }
  }
  return v.length > 1 && v.startsWith("'") && v.endsWith("'")
    ? v.slice(1, -1).replace(/''/g, "'")
    : v;
}

/** Reads `name` and `description` only. Other keys (for example Claude Code's `keep-coding-instructions`) are ignored. */
export function fromMarkdown(text: string): StyleDoc {
  if (text.length > STYLE_LIMITS.file) throw new StyleFormatError("TOO_LONG");
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!m) throw new StyleFormatError("BAD_FILE");
  const keys = new Map<string, string>();
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0 && !/^\s/.test(line)) keys.set(line.slice(0, i).trim(), value(line.slice(i + 1)));
  }
  const name = oneLine(keys.get("name") ?? "");
  const description = oneLine(keys.get("description") ?? "");
  const body = m[2]!.trim();
  if (!name || !body) throw new StyleFormatError("INVALID");
  if (
    name.length > STYLE_LIMITS.name ||
    description.length > STYLE_LIMITS.description ||
    body.length > STYLE_LIMITS.body
  )
    throw new StyleFormatError("TOO_LONG");
  return { name, description, body };
}

/**
 * Reads `apps/server/.env.schema` (varlock's format) into a list of settings, and writes the operator's reference from it
 * (`docs/operations/settings.md`). The schema is the one place a setting is declared, so the reference is generated, never edited by hand:
 * `bun run settings:doc` in apps/server writes it, and a test fails when it is out of date.
 */

export type SchemaEntry = {
  name: string;
  /** The server does not start without it. */
  required: boolean;
  /** A secret: varlock never prints it and the server never returns it. */
  secret: boolean;
  /** What it is, from the comment above it. */
  description: string;
};

const ENTRY = /^([A-Z][A-Z0-9_]*)=/;

/**
 * Entries in file order. A comment block above an entry describes it; entries that follow each other with no blank line between them share the
 * block of the first (`ZETTA_TLS_CERT` and `ZETTA_TLS_KEY`). A line of `# @...` words are varlock decorators, not description.
 */
export function parseEnvSchema(text: string): SchemaEntry[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#\s*---\s*$/.test(line));
  const headerWords = lines
    .slice(0, start < 0 ? 0 : start)
    .flatMap((line) => line.replace(/^#\s*/, "").split(/\s+/));
  const defaultRequired = !headerWords.includes("@defaultRequired=false");
  const defaultSensitive = !headerWords.includes("@defaultSensitive=false");

  const entries: SchemaEntry[] = [];
  let comments: string[] = [];
  let decorators: string[] = [];
  let inherited = "";
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      comments = [];
      decorators = [];
      inherited = "";
      continue;
    }
    if (line.startsWith("#")) {
      const body = line.replace(/^#\s?/, "");
      if (body.startsWith("@")) decorators.push(...body.split(/\s+/).filter(Boolean));
      else comments.push(body.trim());
      continue;
    }
    const match = ENTRY.exec(line);
    if (!match) continue;
    const description = comments.join(" ").replace(/\s+/g, " ").trim() || inherited;
    entries.push({
      name: match[1]!,
      required: decorators.includes("@required=false")
        ? false
        : decorators.some((word) => word === "@required" || word === "@required=true")
          ? true
          : defaultRequired,
      secret:
        decorators.includes("@public") || decorators.includes("@sensitive=false")
          ? false
          : decorators.includes("@sensitive")
            ? true
            : defaultSensitive,
      description,
    });
    inherited = description;
    comments = [];
    decorators = [];
  }
  return entries;
}

/** Settings that follow each other with the same description are one block in the reference. */
function groups(entries: SchemaEntry[]): SchemaEntry[][] {
  const out: SchemaEntry[][] = [];
  for (const entry of entries) {
    const last = out.at(-1);
    if (last && last[0]!.description === entry.description) last.push(entry);
    else out.push([entry]);
  }
  return out;
}

const block = (group: SchemaEntry[]) => {
  const secret = group.every((entry) => entry.secret)
    ? "secret: kept encrypted or out of logs, never shown"
    : group.some((entry) => entry.secret)
      ? "some are secret"
      : "not secret";
  return [
    `### ${group.map((entry) => `\`${entry.name}\``).join(", ")}`,
    "",
    `${group.every((entry) => entry.required) ? "Required" : "Optional"} · ${secret}`,
    "",
    group[0]!.description,
    "",
  ].join("\n");
};

/** The operator's reference, as Markdown. Required settings first, then the optional ones, each in the order of the schema. */
export function renderSettingsDoc(entries: SchemaEntry[]): string {
  const required = groups(entries.filter((entry) => entry.required));
  const optional = groups(entries.filter((entry) => !entry.required));
  return [
    "# Settings reference",
    "",
    "Generated from `apps/server/.env.schema` by `bun run settings:doc` in `apps/server`. Do not edit it by hand: change the schema and run the",
    "command again. A test fails when this page is out of date.",
    "",
    "Set them in `apps/server/.env` (one `NAME=value` per line). With the Docker install, `install.sh` writes the first ones for you and",
    "`docker compose` reads that file. Restart the server after changing one.",
    "",
    "## Required",
    "",
    ...required.map(block),
    "## Optional",
    "",
    ...optional.map(block),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEnvSchema, renderSettingsDoc } from "./env-schema";

const serverDir = join(import.meta.dir, "..");
const repo = join(serverDir, "..", "..");
const schemaText = readFileSync(join(serverDir, ".env.schema"), "utf8");
const entries = parseEnvSchema(schemaText);
const declared = new Set(entries.map((entry) => entry.name));

/** Settings the code reads that an operator is not meant to set: each one says why. A setting that is not here must be in the schema. */
const INTERNAL: Record<string, string> = {
  ZETTA_OPERATOR_ALLOW_MUTATION: "set by the operator identity command itself, not by a person",
  ZETTA_OPERATOR_DATABASE_URL:
    "the operator identity command's own database, given in its protected environment",
  ZETTA_VM_DEMO_FRAMES:
    "records the screen of a VM for the demo videos (docs/demo), not a server setting",
  ZETTA_RECOVERY: "run recovery mode switch of runtime/instance.ts, not documented for operators",
};

/** Every `ZETTA_*` the server's own code reads, with the file that reads it (tests and test support do not count). */
function settingsRead(): Map<string, string> {
  const found = new Map<string, string>();
  const roots = [join(serverDir, "src")];
  for (const name of readdirSync(join(repo, "packages")))
    roots.push(join(repo, "packages", name, "src"));
  for (const root of roots) {
    let files: string[];
    try {
      files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: root })];
    } catch {
      continue;
    }
    for (const file of files) {
      if (/\.test\.|\.integration\.|test-support|\.d\.ts$/.test(file)) continue;
      const text = readFileSync(join(root, file), "utf8");
      for (const match of text.matchAll(/\benv(?:\.|\[["'])(ZETTA_[A-Z0-9_]+)/g))
        if (!found.has(match[1]!)) found.set(match[1]!, join(root, file).replace(`${repo}/`, ""));
    }
  }
  return found;
}

describe("parseEnvSchema", () => {
  const sample = [
    "# @defaultRequired=true",
    "# @defaultSensitive=true",
    "# ---",
    "",
    "# A secret that is needed.",
    "# @type=string",
    "SECRET=",
    "",
    "# A public switch with two names. It is optional.",
    "# @public @required=false",
    "ONE=",
    "# @public @required=false",
    "TWO=",
    "# Its own text.",
    "# @required=false",
    "THREE=",
    "",
    "FOUR=",
  ].join("\n");

  test("reads names in order, what each needs and whether it is a secret", () => {
    expect(
      parseEnvSchema(sample).map(({ name, required, secret }) => ({ name, required, secret })),
    ).toEqual([
      { name: "SECRET", required: true, secret: true },
      { name: "ONE", required: false, secret: false },
      { name: "TWO", required: false, secret: false },
      { name: "THREE", required: false, secret: true },
      { name: "FOUR", required: true, secret: true },
    ]);
  });

  test("a comment describes its setting, entries with no comment of their own share the one above, a blank line ends it", () => {
    const text = parseEnvSchema(sample).map((entry) => entry.description);
    expect(text).toEqual([
      "A secret that is needed.",
      "A public switch with two names. It is optional.",
      "A public switch with two names. It is optional.",
      "Its own text.",
      "",
    ]);
  });

  test("the defaults come from the header", () => {
    const loose = parseEnvSchema(
      "# @defaultRequired=false\n# @defaultSensitive=false\n# ---\n\nA=\n",
    );
    expect(loose).toEqual([{ name: "A", required: false, secret: false, description: "" }]);
  });
});

describe("the server's settings", () => {
  test("every setting the code reads is declared in .env.schema, or listed as internal with its reason", () => {
    const undeclared = [...settingsRead()]
      .filter(([name]) => !declared.has(name) && !(name in INTERNAL))
      .map(([name, file]) => `${name} (read in ${file})`);
    expect(undeclared).toEqual([]);
  });

  test("the internal list only holds settings that are still read and are not declared", () => {
    const read = settingsRead();
    for (const name of Object.keys(INTERNAL)) {
      expect({ name, read: read.has(name) }).toEqual({ name, read: true });
      expect({ name, declared: declared.has(name) }).toEqual({ name, declared: false });
    }
  });

  test("every declared setting says what it is", () => {
    expect(entries.filter((entry) => !entry.description).map((entry) => entry.name)).toEqual([]);
  });

  test("a setting is declared once", () => {
    const names = entries.map((entry) => entry.name);
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });

  test("secrets stay secret: the keys and passwords are never marked public", () => {
    const secrets = entries.filter((entry) => entry.secret).map((entry) => entry.name);
    for (const name of ["BETTER_AUTH_SECRET", "ZETTA_CONNECTION_KEY", "ZETTA_SETUP_KEY"])
      expect(secrets).toContain(name);
    expect(
      secrets.filter((name) => /(_KEY|_SECRET|PASSWORD|TOKEN)$/.test(name)).length,
    ).toBeGreaterThan(3);
    const shown = entries.filter((entry) => !entry.secret).map((entry) => entry.name);
    expect(
      shown.filter((name) => /(SECRET|PASSWORD|API_KEY|CONNECTION_KEY|SETUP_KEY)$/.test(name)),
    ).toEqual([]);
  });
});

describe("docs/operations/settings.md", () => {
  test("is the page generated from the schema (run `bun run settings:doc` in apps/server)", () => {
    const page = readFileSync(join(repo, "docs", "operations", "settings.md"), "utf8");
    expect(page).toBe(renderSettingsDoc(entries));
  });

  test("lists the required settings first and every setting once", () => {
    const page = renderSettingsDoc(entries);
    expect(page.indexOf("## Required")).toBeLessThan(page.indexOf("## Optional"));
    for (const entry of entries) {
      const mentions = page.split(`\`${entry.name}\``).length - 1;
      expect({ name: entry.name, mentions }).toEqual({ name: entry.name, mentions: 1 });
    }
  });
});

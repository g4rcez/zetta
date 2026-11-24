// Enforces "only the host is configured through the environment": the source may read only the names of `HOST_ENV` (and, while the program
// that moved settings into the database is over, `MIGRATING` is empty and stays so). See host-env.ts for what the scan covers and what it cannot see.
// This file is in packages/core so it runs in the unit-test job of CI (scripts/verify.sh) on every push.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DYNAMIC_READS, HOST_ENV, MIGRATING, NAME_PREFIXES } from "./host-env";
import { LEGACY_VOICE_ENV, SECRETS_NOT_IMPORTED, SETTINGS } from "./settings";

const root = join(import.meta.dir, "../../..");

// apps/desktop (the desktop app and its installer), docker files, and the demo and e2e kits are out of scope on purpose: they set
// variables for their own processes. Test files, scripts and test support are not product code.
const SOURCE_DIRS = [
  "apps/server/src",
  "apps/web/src",
  "apps/cli/src",
  ...readdirSync(join(root, "packages")).map((p) => `packages/${p}/src`),
];
const SKIPPED_DIRS = new Set([
  "node_modules",
  "test-support",
  "scripts",
  "__fixtures__",
  "fixtures",
  "dist",
]);
const SOURCE_FILE = /\.(ts|tsx|mts|js|mjs)$/;
const NOT_SOURCE = /(\.(test|spec|integration)\.(ts|tsx)|\.gen\.ts)$/;
// The generated typed view of the schema, and the files that hold the names on purpose.
const SKIPPED_FILES = new Set([
  "apps/server/src/env.ts",
  "packages/core/src/host-env.ts",
  "packages/core/src/host-env.test.ts",
  "packages/core/src/settings.ts",
  "packages/core/src/settings.test.ts",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(root, dir));
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = `${dir}/${entry}`;
    if (statSync(join(root, path)).isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) sourceFiles(path, out);
    } else if (SOURCE_FILE.test(entry) && !NOT_SOURCE.test(entry) && !SKIPPED_FILES.has(path))
      out.push(path);
  }
  return out;
}

/** Block comments and line comments are dropped (a `//` after a quote or a colon is kept, as in a URL). Good enough for a scan, not a parser. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const NAME = /^[A-Z][A-Z0-9_]+$/;
const READER = String.raw`(?:process\.env|Bun\.env|import\.meta\.env|\bENV|\benv)`;

/** Every environment name a piece of source reads, and every dynamic read expression it holds. */
export function scanSource(text: string): { names: Set<string>; dynamic: Set<string> } {
  const code = stripComments(text);
  const names = new Set<string>();
  const dynamic = new Set<string>();
  const add = (name: string | undefined) => {
    if (name && NAME.test(name)) names.add(name);
  };
  // process.env.NAME, Bun.env.NAME, import.meta.env.NAME, ENV.NAME, env.NAME (a parameter or alias that holds the environment).
  for (const m of code.matchAll(
    new RegExp(`${READER}\\s*\\??\\.\\s*([A-Za-z_][A-Za-z0-9_]*)`, "g"),
  ))
    add(m[1]);
  // process.env["NAME"] and friends; a computed name is a dynamic read.
  for (const m of code.matchAll(new RegExp(`${READER}\\s*\\??\\.?\\[\\s*([^\\]]*?)\\s*\\]`, "g"))) {
    const literal = /^["'`]([A-Z][A-Z0-9_]+)["'`]$/.exec(m[1]!);
    if (literal) add(literal[1]);
    else if (/^(process\.env|Bun\.env)/.test(m[0])) dynamic.add(m[0].replace(/\s+/g, ""));
  }
  // const { NAME, OTHER: alias } = process.env
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*(?:process\.env|Bun\.env)\b/g))
    for (const part of m[1]!.split(",")) add(part.trim().split(/[\s:=]/)[0]);
  // A ZETTA_ name written anywhere in code (a constant such as SPEECH_KEY_ENV, a list of passed names, a message that tells the person
  // to set one). Comments are already gone. This is what catches reads the shapes above cannot see.
  for (const m of code.matchAll(/\bZETTA_[A-Z0-9_]*[A-Z0-9]/g)) names.add(m[0]);
  return { names, dynamic };
}

const prefixOf = (name: string) =>
  NAME_PREFIXES.find(
    (p) =>
      name === p.prefix ||
      (name.startsWith(p.prefix) && /^[_0-9]/.test(name.slice(p.prefix.length))),
  );
/** The names a scan found that nobody declared. */
export const unknownNames = (found: Iterable<string>) =>
  [...found]
    .filter((name) => !(name in HOST_ENV) && !(name in MIGRATING) && !prefixOf(name))
    .sort();

function scanAll() {
  const byName = new Map<string, Set<string>>();
  const dynamic: { file: string; expression: string }[] = [];
  for (const dir of SOURCE_DIRS)
    for (const file of sourceFiles(dir)) {
      const found = scanSource(readFileSync(join(root, file), "utf8"));
      for (const name of found.names) {
        if (!byName.has(name)) byName.set(name, new Set());
        byName.get(name)!.add(file);
      }
      for (const expression of found.dynamic) dynamic.push({ file, expression });
    }
  return { byName, dynamic };
}

const where = (byName: Map<string, Set<string>>, name: string) =>
  `${name} (${[...(byName.get(name) ?? [])].slice(0, 3).join(", ")})`;

describe("the scanner", () => {
  test("sees every shape a variable is read in", () => {
    const { names, dynamic } = scanSource(`
      const a = process.env.ZETTA_ONE;
      const b = process.env["TWO_NAME"];
      const c = Bun.env.THREE_NAME;
      const d = import.meta.env.VITE_FOUR;
      const e = ENV.FIVE_NAME;
      const f = env.SIX_NAME ?? opts.env.SEVEN_NAME;
      const { EIGHT_NAME, NINE_NAME: nine } = process.env;
      const g = process.env[someName];
      const h = "Set ZETTA_TEN_MESSAGE=1 to allow it";
    `);
    expect([...names].sort()).toEqual(
      [
        "ZETTA_ONE",
        "TWO_NAME",
        "THREE_NAME",
        "VITE_FOUR",
        "FIVE_NAME",
        "SIX_NAME",
        "SEVEN_NAME",
        "EIGHT_NAME",
        "NINE_NAME",
        "ZETTA_TEN_MESSAGE",
      ].sort(),
    );
    expect([...dynamic]).toEqual(["process.env[someName]"]);
  });

  test("ignores names in comments", () => {
    const { names } = scanSource(
      `// process.env.ZETTA_IN_LINE\n/* ZETTA_IN_BLOCK and process.env.OTHER_BLOCK */\nconst x = 1;`,
    );
    expect(names.size).toBe(0);
  });

  test("flags a name that nobody declared (the failing case of the guard)", () => {
    const fixture = `export const secret = process.env.ZETTA_SOME_NEW_SWITCH === "on";`;
    expect(unknownNames(scanSource(fixture).names)).toEqual(["ZETTA_SOME_NEW_SWITCH"]);
    // A declared host name passes; a name that was removed with its setting does not; a built name passes through its prefix.
    expect(
      unknownNames([
        "ZETTA_HOME",
        "ZETTA_SPEECH_LOCAL",
        "ZETTA_PLAYGROUND_IMAGE_PYTHON3",
        "ZETTA_PLAYGROUND_IMAGEX",
      ]),
    ).toEqual(["ZETTA_PLAYGROUND_IMAGEX", "ZETTA_SPEECH_LOCAL"]);
  });
});

describe("the environment guard", () => {
  test("the lists do not overlap and every entry has a reason", () => {
    const both = Object.keys(HOST_ENV).filter((name) => name in MIGRATING);
    expect(both).toEqual([]);
    for (const [name, entry] of Object.entries(HOST_ENV)) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(["bootstrap", "host"]).toContain(entry.kind);
      expect(entry.reason.trim().length).toBeGreaterThan(10);
    }
    for (const [name, to] of Object.entries(MIGRATING)) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(to.trim().length).toBeGreaterThan(3);
    }
    for (const p of NAME_PREFIXES) expect(p.reason.length).toBeGreaterThan(10);
  });

  test("the registry's legacy variables are never on the host list", () => {
    for (const def of Object.values(SETTINGS)) {
      expect(def.env in HOST_ENV).toBe(false);
      for (const old of (def as { envAlso?: readonly string[] }).envAlso ?? [])
        expect(old in HOST_ENV).toBe(false);
    }
  });

  test("no source file reads a name that is neither host-level nor migrating", () => {
    const { byName } = scanAll();
    expect(byName.size).toBeGreaterThan(40);
    const unknown = unknownNames(byName.keys());
    expect(unknown.map((name) => where(byName, name))).toEqual([]);
  });

  test("the migrating list is empty: a product setting is never added to it", () => {
    // The program that moved settings into the database is finished. New product settings go in the registry (settings.ts), an
    // installation setting or a sealed connection, never in the environment and never on this list.
    expect(Object.keys(MIGRATING)).toEqual([]);
  });

  test("a read whose name is computed is listed with a reason", () => {
    const { dynamic } = scanAll();
    const unlisted = dynamic.filter(
      (d) =>
        !DYNAMIC_READS.some(
          (l) => l.file === d.file && l.expression.replace(/\s+/g, "") === d.expression,
        ),
    );
    expect(unlisted).toEqual([]);
    // And an entry whose read is gone is removed.
    const gone = DYNAMIC_READS.filter(
      (l) =>
        !dynamic.some(
          (d) => d.file === l.file && d.expression === l.expression.replace(/\s+/g, ""),
        ),
    );
    expect(gone).toEqual([]);
  });

  test("a .env.schema declares only names on a list or replaced by a setting", () => {
    const schemas = ["apps/server", "apps/web", "packages/db", "packages/infra"].map(
      (d) => `${d}/.env.schema`,
    );
    const imported = new Set(
      Object.values(SETTINGS).flatMap((def) => [
        def.env,
        ...((def as { envAlso?: readonly string[] }).envAlso ?? []),
      ]),
    );
    // A secret's variable is declared (deprecated) so the server can warn; it is never imported.
    for (const name of Object.keys(SECRETS_NOT_IMPORTED)) imported.add(name);
    // The voice variables imported once into the installation settings row are declared (deprecated) for the same reason.
    for (const name of Object.values(LEGACY_VOICE_ENV)) imported.add(name);
    const undeclared: string[] = [];
    let declared = 0;
    for (const schema of schemas) {
      let text = "";
      try {
        text = readFileSync(join(root, schema), "utf8");
      } catch {
        continue;
      }
      for (const m of text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
        declared++;
        const name = m[1]!;
        if (!(name in HOST_ENV) && !(name in MIGRATING) && !imported.has(name))
          undeclared.push(`${name} (${relative(root, join(root, schema))})`);
      }
    }
    expect(declared).toBeGreaterThan(50);
    expect(undeclared).toEqual([]);
  });
});

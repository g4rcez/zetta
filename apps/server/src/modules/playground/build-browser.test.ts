import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBrowser } from "./build-browser";
import { PlaygroundError } from "./types";

const detail = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(PlaygroundError);
  return (e as PlaygroundError).detail;
};

const build = (importPath: string) =>
  buildBrowser({
    language: "typescript",
    entry: "main.ts",
    files: [{ path: "main.ts", content: `import x from "${importPath}";\nconsole.log(x);\n` }],
    inputs: {},
  } as Parameters<typeof buildBrowser>[0]);

describe("buildBrowser import confinement", () => {
  test("rejects an absolute path outside the playground folder", async () => {
    expect(await detail(build("/etc/hosts"))).toContain("leaves the playground");
  });
  test("rejects a relative path that climbs out of the folder", async () => {
    expect(await detail(build("../../outside"))).toContain("leaves the playground");
  });
});

/** A build of `files`, entry `main.ts` unless said otherwise. */
const project = (files: Record<string, string>, o: { entry?: string; timeoutMs?: number } = {}) =>
  buildBrowser({
    language: "typescript",
    entry: o.entry ?? "main.ts",
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    inputs: {},
    timeoutMs: o.timeoutMs,
  } as Parameters<typeof buildBrowser>[0]);

describe("buildBrowser never runs the code it bundles", () => {
  // Each spelling asks a bundler with macros to run `m.ts` on the server. The macro leaves a file behind when it runs.
  const spellings: [string, string][] = [
    ["a quoted key", 'import { x } from "./m.ts" with { "type": "macro" };'],
    ["a comment before the colon", 'import { x } from "./m.ts" with { type /**/ : "macro" };'],
    ["a comment after the colon", 'import { x } from "./m.ts" with { type: /**/ "macro" };'],
    ["an escaped value", 'import { x } from "./m.ts" with { type: "m\\x61cro" };'],
    ["the macro: prefix", 'import { x } from "macro:./m.ts";'],
  ];
  for (const [name, line] of spellings)
    test(name, async () => {
      const dir = await mkdtemp(join(tmpdir(), "zetta-macro-"));
      const marker = join(dir, "ran");
      try {
        await project({
          "m.ts": `export async function x() { await Bun.write(${JSON.stringify(marker)}, "ran"); return "MACRO_RAN"; }`,
          "main.ts": `${line}\nconsole.log(x());\n`,
        }).catch(() => undefined);
        expect(existsSync(marker)).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
});

describe("buildBrowser reads only the playground's files", () => {
  test("a package.json that points outside the folder is refused", async () => {
    const name = `zetta-outside-${process.pid}-${Date.now()}.js`;
    const secret = join(await realpath(tmpdir()), name);
    await writeFile(secret, 'export const s = "OUTSIDE_SECRET";\n');
    try {
      const built = await project({
        "lib/package.json": JSON.stringify({ main: `../../${name}` }),
        "main.ts": 'import { s } from "./lib";\nconsole.log(s);\n',
      }).then(
        (r) => r.html,
        () => "refused",
      );
      expect(built).not.toContain("OUTSIDE_SECRET");
    } finally {
      await rm(secret, { force: true });
    }
  });

  test("a query on a relative path does not escape the folder", async () => {
    expect(await detail(build("../../outside?raw"))).toContain("leaves the playground");
  });

  test("a library named by JSX is not a file of the playground", async () => {
    expect(
      await detail(project({ "main.tsx": "console.log(<div />);\n" }, { entry: "main.tsx" })),
    ).toContain("is not a file of the playground");
  });

  test("a stylesheet imported by a script is left out", async () => {
    const { html } = await project({
      "s.css": "body { color: red }",
      "main.ts": 'import "./s.css";\nconsole.log("built");\n',
    });
    expect(html).toContain("built");
    expect(html).not.toContain("color: red");
  });

  test("files import each other, and a CDN address stays an address", async () => {
    const { html } = await project({
      "lib/greet.ts": 'export const greet = (n: string) => "hi " + n;',
      "main.ts":
        'import { greet } from "./lib/greet";\nimport x from "https://cdn.jsdelivr.net/npm/x/+esm";\nconsole.log(greet("ana"), x);\n',
    });
    expect(html).toContain("https://cdn.jsdelivr.net/npm/x/+esm");
    expect(html).toContain("hi ");
  });

  test("a build that takes too long is stopped", async () => {
    expect(await detail(project({ "main.ts": "console.log(1);\n" }, { timeoutMs: 0 }))).toContain(
      "took too long",
    );
  });
});

describe("buildBrowser bundles ordinary module styles", () => {
  test("a CommonJS file, a JSON file and a text file are bundled", async () => {
    const { html } = await project({
      "c.cjs": 'module.exports = { word: "from-commonjs" };',
      "data.json": '{ "word": "from-json" }',
      "note.txt": "from-text",
      "main.ts":
        'import c from "./c.cjs";\nimport data from "./data.json";\nimport note from "./note.txt";\nconsole.log(c.word, data.word, note);\n',
    });
    for (const word of ["from-commonjs", "from-json", "from-text"]) expect(html).toContain(word);
  });

  test("a build error names the file, not the server's folders", async () => {
    const message = await detail(project({ "main.ts": "const = ;\n" }));
    expect(message).toContain("main.ts");
    expect(message).not.toContain("zetta-playground-build-");
  });
});

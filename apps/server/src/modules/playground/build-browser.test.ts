import { describe, expect, test } from "bun:test";
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

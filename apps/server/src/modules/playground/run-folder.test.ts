import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectOutputs, readResult, writeFolder } from "./run-folder";

// `runs` is the folder a container has mounted: a script in it can replace anything under it.
let dir: string;
let runs: string;
let outside: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zetta-run-folder-"));
  runs = join(dir, "runs");
  outside = join(dir, "outside");
  await mkdir(join(runs, "r-1"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "secret"), "SECRET");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = () => join(runs, "r-1");
const kept = async () => (await collectOutputs(runs, "r-1/out")).outputs.map((o) => o.path);

describe("the folder of a run", () => {
  test("holds the files, the inputs and an empty out/, whose files come back", async () => {
    await writeFolder(run(), { files: [{ path: "lib/a.sh", content: "echo" }], inputs: {} }, runs);
    expect((await readdir(run())).sort()).toEqual(["inputs.json", "lib", "out"]);
    await writeFile(join(run(), "out", "b.txt"), "b");
    await mkdir(join(run(), "out", "d"));
    await writeFile(join(run(), "out", "d", "c.txt"), "c");
    expect(await kept()).toEqual(["b.txt", "d/c.txt"]);
    await writeFile(join(run(), "result.json"), "{}");
    expect(await readResult(runs, "r-1", { resultFile: "result.json" })).toBe("{}");
  });
});

describe.skipIf(process.platform === "win32")("a link a script plants", () => {
  test("in place of out/ gives no outputs", async () => {
    await symlink(outside, join(run(), "out"));
    expect(await kept()).toEqual([]);
  });

  test("in place of the run folder gives no outputs", async () => {
    await mkdir(join(outside, "out"));
    await writeFile(join(outside, "out", "secret"), "SECRET");
    await rm(run(), { recursive: true });
    await symlink(outside, run());
    expect(await kept()).toEqual([]);
  });

  test("inside out/ is skipped", async () => {
    await mkdir(join(run(), "out"));
    await symlink(outside, join(run(), "out", "d"));
    await symlink(join(outside, "secret"), join(run(), "out", "f"));
    expect(await kept()).toEqual([]);
  });

  test("on the way to the result file hides it", async () => {
    await writeFile(join(outside, "result.json"), "SECRET");
    await symlink(outside, join(run(), "sub"));
    expect(await readResult(runs, "r-1", { resultFile: "sub/result.json" })).toBeUndefined();
  });

  test("where the server is about to write sends nothing outside", async () => {
    await symlink(outside, join(run(), "lib"));
    await expect(
      writeFolder(run(), { files: [{ path: "lib/new", content: "x" }], inputs: {} }, runs),
    ).rejects.toThrow();
    await symlink(join(outside, "secret"), join(run(), "main.sh"));
    await rm(join(run(), "lib"));
    await writeFolder(run(), { files: [{ path: "main.sh", content: "mine" }], inputs: {} }, runs);
    expect(await readFile(join(outside, "secret"), "utf8")).toBe("SECRET");
    expect(await readdir(outside)).toEqual(["secret"]);
  });
});

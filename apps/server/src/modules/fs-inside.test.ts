import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderInside, LinkError, openInside, readInside, writeInside } from "./fs-inside";

let dir: string;
let root: string;
let outside: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zetta-inside-"));
  root = join(dir, "root");
  outside = join(dir, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "secret"), "SECRET");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const text = async (path: string, max = 1000) => (await readInside(root, path, max))?.toString();

describe("a file inside a folder", () => {
  test("is written, read back and replaced", async () => {
    await writeInside(root, "a/b/c.txt", "one");
    expect(await text("a/b/c.txt")).toBe("one");
    await writeInside(root, join(root, "a/b/c.txt"), "two");
    expect(await text(join(root, "a/b/c.txt"))).toBe("two");
    expect(await readdir(join(root, "a/b"))).toEqual(["c.txt"]);
  });

  test("copies an open file", async () => {
    const source = await open(join(outside, "secret"), "r");
    try {
      await writeInside(root, "copy", source);
    } finally {
      await source.close();
    }
    expect(await text("copy")).toBe("SECRET");
  });

  test("larger than the limit is not read", async () => {
    await writeInside(root, "big", "12345");
    expect(await text("big", 4)).toBeUndefined();
  });

  test("a path that leaves the folder is refused", async () => {
    expect(await text("../outside/secret")).toBeUndefined();
    await expect(writeInside(root, "../outside/new", "x")).rejects.toBeInstanceOf(LinkError);
    expect(existsSync(join(outside, "new"))).toBe(false);
  });
});

describe.skipIf(process.platform === "win32")("a planted link", () => {
  test("to a file is never read", async () => {
    await symlink(join(outside, "secret"), join(root, "leak"));
    expect(await text("leak")).toBeUndefined();
    expect(await openInside(root, "leak")).toBeUndefined();
  });

  test("to a folder is never read through", async () => {
    await symlink(outside, join(root, "out"));
    expect(await text("out/secret")).toBeUndefined();
  });

  test("to a file is replaced, never written through", async () => {
    await symlink(join(outside, "secret"), join(root, "leak"));
    await writeInside(root, "leak", "mine");
    expect(await readFile(join(outside, "secret"), "utf8")).toBe("SECRET");
    expect(await text("leak")).toBe("mine");
  });

  test("that points at nothing yet is replaced, so nothing appears outside", async () => {
    await symlink(join(outside, "later"), join(root, "dangling"));
    await writeInside(root, "dangling", "mine");
    expect(existsSync(join(outside, "later"))).toBe(false);
  });

  test("in place of a folder stops the write", async () => {
    await symlink(outside, join(root, "out"));
    await expect(writeInside(root, "out/new", "x")).rejects.toBeInstanceOf(LinkError);
    await expect(folderInside(root, "out/sub")).rejects.toBeInstanceOf(LinkError);
    expect(await readdir(outside)).toEqual(["secret"]);
  });
});

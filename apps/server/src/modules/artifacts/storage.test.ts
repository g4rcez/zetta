import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactFileError, classify, saveContent, savePath } from "./storage";

let dir: string;
let codeDir: string;
let root: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifacts-"));
  codeDir = join(dir, "work");
  root = join(dir, "store");
  await mkdir(codeDir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof ArtifactFileError ? e.code : "other"),
  );

describe("classify", () => {
  test("derives the kind from the file name when the mime type is missing or odd", () => {
    expect(classify("report.html").kind).toBe("html");
    expect(classify("data.csv").kind).toBe("csv");
    expect(classify("demo.mp4")).toEqual({ mimeType: "video/mp4", kind: "video" });
    expect(classify("bundle.zip").kind).toBe("zip");
    expect(classify("main.py").kind).toBe("code");
    expect(classify("blob.bin", "not a mime").kind).toBe("binary");
  });
  test("the declared mime type wins when it is well formed", () => {
    expect(classify("x", "image/png; charset=binary")).toEqual({
      mimeType: "image/png",
      kind: "image",
    });
  });
});

describe("saveContent", () => {
  test("stores inline text once under its hash", async () => {
    const a = await saveContent("u1", "hello", root);
    const b = await saveContent("u1", "hello", root);
    expect(a).toEqual({
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      size: 5,
    });
    expect(b.sha256).toBe(a.sha256);
    expect(await readFile(join(root, "u1", a.sha256), "utf8")).toBe("hello");
  });
  test("refuses empty and oversized text", async () => {
    expect(await code(saveContent("u1", "", root))).toBe("INVALID");
    expect(await code(saveContent("u1", "x".repeat(256 * 1024 + 1), root))).toBe("TOO_LARGE");
  });
});

describe("savePath", () => {
  test("copies a code directory file and reports its name and size", async () => {
    await mkdir(join(codeDir, "out"));
    await writeFile(join(codeDir, "out", "sales.html"), "<h1>hi</h1>");
    const r = await savePath("u1", "out/sales.html", codeDir, root);
    expect(r.fileName).toBe("sales.html");
    expect(r.size).toBe(11);
    expect(await readFile(join(root, "u1", r.sha256), "utf8")).toBe("<h1>hi</h1>");
  });
  test("refuses a path that leaves the code directory", async () => {
    await writeFile(join(dir, "secret.txt"), "secret");
    expect(await code(savePath("u1", "../secret.txt", codeDir, root))).toBe("NOT_FOUND");
    expect(await code(savePath("u1", join(dir, "secret.txt"), codeDir, root))).toBe("NOT_FOUND");
  });
  test("refuses a symlink that points outside the code directory", async () => {
    await writeFile(join(dir, "secret.txt"), "secret");
    await symlink(join(dir, "secret.txt"), join(codeDir, "link.txt"));
    expect(await code(savePath("u1", "link.txt", codeDir, root))).toBe("NOT_FOUND");
  });
  test("refuses a missing file, a directory and an empty file", async () => {
    await mkdir(join(codeDir, "d"));
    await writeFile(join(codeDir, "empty.txt"), "");
    expect(await code(savePath("u1", "nope.txt", codeDir, root))).toBe("NOT_FOUND");
    expect(await code(savePath("u1", "d", codeDir, root))).toBe("NOT_FOUND");
    expect(await code(savePath("u1", "empty.txt", codeDir, root))).toBe("INVALID");
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSource, PUBLIC_REPOSITORY, sourceSpec } from "./source";
import type { Workspace } from "./workspace";

const standalone: Workspace = { mode: "standalone", values: "/nowhere", valuesLabel: "nowhere" };
const checkout: Workspace = { ...standalone, mode: "checkout", root: "/clone" };

let folder = "";
beforeEach(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), "zetta-source-test-")));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
  delete (globalThis as { zettaInfraEmbedded?: unknown }).zettaInfraEmbedded;
});

/** A repository with two commits; returns their ids. */
function repository() {
  const git = (...args: string[]) => {
    const done = Bun.spawnSync(
      ["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
      { cwd: folder },
    );
    if (done.exitCode !== 0) throw new Error(done.stderr.toString());
    return done.stdout.toString().trim();
  };
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(folder, "file.txt"), "one\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "one");
  const first = git("rev-parse", "HEAD");
  writeFileSync(join(folder, "file.txt"), "two\n");
  git("commit", "--quiet", "-am", "two");
  return { first, second: git("rev-parse", "HEAD") };
}

describe("which code a deploy takes", () => {
  test("the clone it runs in, at HEAD", () => {
    expect(sourceSpec(checkout, {})).toEqual({ from: "checkout", root: "/clone", ref: "HEAD" });
    expect(sourceSpec(checkout, { ref: "v1" })).toMatchObject({ from: "checkout", ref: "v1" });
  });

  test("with no clone, the public repository at the commit the binary was built from", () => {
    expect(sourceSpec(standalone, {})).toEqual({
      from: "remote",
      url: PUBLIC_REPOSITORY,
      ref: "HEAD",
    });
    (globalThis as { zettaInfraEmbedded?: unknown }).zettaInfraEmbedded = { commit: "abc1234" };
    expect(sourceSpec(standalone, {})).toMatchObject({ url: PUBLIC_REPOSITORY, ref: "abc1234" });
    expect(sourceSpec(standalone, { ref: "main" })).toMatchObject({ ref: "main" });
  });

  test("--repo wins: a folder is a clone, anything else must be an address", () => {
    expect(sourceSpec(checkout, { repo: folder })).toEqual({
      from: "checkout",
      root: folder,
      ref: "HEAD",
    });
    expect(sourceSpec(checkout, { repo: "git@example.invalid:me/zetta.git" })).toEqual({
      from: "remote",
      url: "git@example.invalid:me/zetta.git",
      ref: "HEAD",
    });
    for (const bad of ["--upload-pack=id", "/no/such/folder", "http://example.invalid/x.git"])
      expect(() => sourceSpec(checkout, { repo: bad })).toThrow(/not a folder here/);
  });
});

describe("opening the code", () => {
  test("a clone gives the commit of the ref and removes nothing", async () => {
    const { first, second } = repository();
    const source = await openSource({ from: "checkout", root: folder, ref: "HEAD~1" });
    expect(source.commit.id).toBe(first);
    expect(source.root).toBe(folder);
    source.remove();
    expect(existsSync(join(folder, "file.txt"))).toBe(true);
    expect((await openSource({ from: "checkout", root: folder, ref: "HEAD" })).commit.id).toBe(
      second,
    );
  });

  test("an address is fetched into a folder of its own, by branch or by commit, and removed after", async () => {
    const { first, second } = repository();
    const url = `file://${folder}`;
    const byBranch = await openSource({ from: "remote", url, ref: "main" });
    expect(byBranch.commit.id).toBe(second);
    expect(byBranch.root).not.toBe(folder);
    const archive = Bun.spawnSync(["git", "archive", "--format=tar", byBranch.commit.id], {
      cwd: byBranch.root,
    });
    expect(archive.exitCode).toBe(0);
    byBranch.remove();
    expect(existsSync(byBranch.root)).toBe(false);

    const byCommit = await openSource({ from: "remote", url, ref: first });
    expect(byCommit.commit.id).toBe(first);
    byCommit.remove();
  });

  test("a ref or an address that git would read as an option is refused", async () => {
    const url = `file://${folder}`;
    await expect(openSource({ from: "remote", url, ref: "--upload-pack=id" })).rejects.toThrow(
      /Cannot fetch/,
    );
    await expect(openSource({ from: "remote", url: "-oX", ref: "main" })).rejects.toThrow(
      /Cannot fetch/,
    );
  });

  test("a ref that is not there says so and leaves no folder behind", async () => {
    repository();
    const before = new Set(
      new Bun.Glob("zetta-source-*").scanSync({ cwd: tmpdir(), onlyFiles: false }),
    );
    await expect(
      openSource({ from: "remote", url: `file://${folder}`, ref: "no-such-branch" }),
    ).rejects.toThrow(/Could not fetch "no-such-branch"/);
    const after = [...new Bun.Glob("zetta-source-*").scanSync({ cwd: tmpdir(), onlyFiles: false })];
    expect(
      after.filter((name) => !before.has(name) && !name.startsWith("zetta-source-test-")),
    ).toEqual([]);
  });
});

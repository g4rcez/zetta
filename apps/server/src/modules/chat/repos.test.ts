import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { githubRepoOf, touchedRepos } from "./repos";

describe("githubRepoOf", () => {
  test("reads https, ssh and scp remotes, and drops credentials", () => {
    expect(githubRepoOf("https://github.com/g4rcez/zetta.git")).toBe("g4rcez/zetta");
    expect(githubRepoOf("git@github.com:g4rcez/zetta.git")).toBe("g4rcez/zetta");
    expect(githubRepoOf("ssh://git@github.com/g4rcez/zetta")).toBe("g4rcez/zetta");
    expect(githubRepoOf("https://x-access-token:ghp_secret@github.com/g4rcez/zetta.git")).toBe(
      "g4rcez/zetta",
    );
  });
  test("ignores other hosts", () => {
    expect(githubRepoOf("https://gitlab.com/g4rcez/zetta.git")).toBeUndefined();
  });
});

async function clone(root: string, dir: string, url: string, activityAt: Date) {
  const git = join(root, dir, ".git");
  await mkdir(join(git, "logs"), { recursive: true });
  await writeFile(
    join(git, "config"),
    `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
  );
  await writeFile(join(git, "logs", "HEAD"), "x");
  await utimes(join(git, "logs", "HEAD"), activityAt, activityAt);
}

describe("touchedRepos", () => {
  test("lists only GitHub repositories with git activity since the run started", async () => {
    const root = await mkdtemp(join(tmpdir(), "zetta-repos-"));
    await clone(root, "new", "https://github.com/acme/new.git", new Date(2_000_000));
    await clone(root, "old", "https://github.com/acme/old.git", new Date(1_000_000));
    await clone(root, "elsewhere", "https://gitlab.com/acme/other.git", new Date(2_000_000));
    await mkdir(join(root, "plain-folder"));
    expect(await touchedRepos(root, 1_500_000)).toEqual(["acme/new"]);
  });
  test("a missing code directory has no repositories", async () => {
    expect(await touchedRepos(join(tmpdir(), "zetta-no-such-dir"), 0)).toEqual([]);
  });
});

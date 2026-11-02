import { describe, expect, test } from "bun:test";
import { parseSource, readSkill } from "./market";

describe("parseSource", () => {
  test("reads owner/repo, owner/repo/skill and GitHub or skills.sh links", () => {
    expect(parseSource("acme/skills")).toEqual({ owner: "acme", repo: "skills" });
    expect(parseSource("  acme/skills/pdf ")).toEqual({
      owner: "acme",
      repo: "skills",
      skill: "pdf",
    });
    expect(parseSource("https://github.com/acme/skills")).toEqual({
      owner: "acme",
      repo: "skills",
    });
    expect(parseSource("https://github.com/acme/skills.git")).toEqual({
      owner: "acme",
      repo: "skills",
    });
    expect(parseSource("github.com/acme/skills/tree/main/skills/pdf")).toEqual({
      owner: "acme",
      repo: "skills",
      ref: "main",
      path: "skills/pdf",
    });
    expect(
      parseSource("https://github.com/acme/skills/blob/v1/skills/pdf/SKILL.md?plain=1"),
    ).toEqual({
      owner: "acme",
      repo: "skills",
      ref: "v1",
      path: "skills/pdf",
    });
    expect(parseSource("https://skills.sh/acme/skills/pdf")).toEqual({
      owner: "acme",
      repo: "skills",
      skill: "pdf",
    });
  });
  test("refuses anything that is not a GitHub repository", () => {
    for (const bad of [
      "",
      "acme",
      "acme/skills/a/b",
      "https://evil.example/acme/skills",
      "http://169.254.169.254/latest/meta-data",
      "ftp://github.com/acme/skills",
      "../etc/passwd",
      "acme/../skills",
      "-acme/skills",
      "https://github.com/acme/skills/tree/main/../../x",
    ])
      expect(parseSource(bad)).toBeUndefined();
  });
});

describe("readSkill", () => {
  const file = (head: string, body = "1) do it") => `---\n${head}\n---\n${body}`;
  test("takes the folder as the name and the description from the frontmatter", () => {
    expect(readSkill(file("name: Pretty Name\ndescription: Make PDFs"), "pdf-tools")).toEqual({
      name: "pdf-tools",
      description: "Make PDFs",
      body: "1) do it",
      warnings: [],
    });
  });
  test("falls back to the frontmatter name when the folder is not a valid name", () => {
    expect(readSkill(file("name: Next.js Development\ndescription: d"), "Bad_Folder").name).toBe(
      "next-js-development",
    );
    expect(readSkill(file("description: d"), "Bad_Folder").warnings).toEqual(["invalid_name"]);
  });
  test("warns about empty, large, shell and secret text", () => {
    expect(readSkill(file("description: d", ""), "x").warnings).toEqual(["empty"]);
    expect(readSkill(file("description: d", "x".repeat(24_001)), "x").warnings).toEqual([
      "too_large",
    ]);
    expect(readSkill(file("description: d"), "x", true).warnings).toEqual(["too_large"]);
    expect(readSkill(file("description: d", "Run !`id`"), "x").warnings).toEqual([
      "shell_injection",
    ]);
    expect(
      readSkill(file("description: d", "key sk-test-0123456789abcdefghij"), "x").warnings,
    ).toEqual(["looks_secret"]);
  });
});

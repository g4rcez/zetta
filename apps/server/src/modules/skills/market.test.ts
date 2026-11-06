import { describe, expect, test } from "bun:test";
import { parseSource, readSkill, skillDirs, skillFolders, type TreeEntry } from "./market";

const blob = (path: string, size = 10, mode = "100644") => ({ path, type: "blob", mode, size });
const folders = (tree: TreeEntry[]) => skillFolders(tree, skillDirs(tree));

describe("skillFolders", () => {
  test("a skill gets its files; a nested skill keeps its own; links, submodules, node_modules, .git and the SKILL.md itself are left out", () => {
    const tree = [
      blob("README.md"),
      blob("deck/SKILL.md"),
      blob("deck/scripts/run.py", 20, "100755"),
      blob("deck/assets/logo.png", 30),
      blob("deck/link", 5, "120000"),
      { path: "deck/vendor", type: "commit", mode: "160000" },
      blob("deck/node_modules/x/index.js"),
      blob("deck/.git/config"),
      blob("deck/nested/SKILL.md"),
      blob("deck/nested/data.txt", 7),
    ];
    const found = folders(tree);
    expect(found.get("deck")).toEqual({
      files: [
        { path: "assets/logo.png", size: 30, mode: "file" },
        { path: "scripts/run.py", size: 20, mode: "executable" },
      ],
      bytes: 50,
      tooLarge: false,
    });
    expect(found.get("deck/nested")).toEqual({
      files: [{ path: "data.txt", size: 7, mode: "file" }],
      bytes: 7,
      tooLarge: false,
    });
  });
  test("a SKILL.md at the repository root owns the files that no other skill owns", () => {
    const found = folders([
      blob("SKILL.md"),
      blob("scripts/a.sh"),
      blob("other/SKILL.md"),
      blob("other/b.txt"),
    ]);
    expect(found.get("")!.files.map((f) => f.path)).toEqual(["scripts/a.sh"]);
    expect(found.get("other")!.files.map((f) => f.path)).toEqual(["b.txt"]);
  });
  test("a name with a control character or a backslash is left out; spaces, dots and accents are fine", () => {
    const found = folders([
      blob("a/SKILL.md"),
      blob("a/bad\\name.txt"),
      blob("a/bad\u0001name.txt"),
      blob("a/my notes.v2.md"),
      blob("a/café.txt"),
    ]);
    expect(found.get("a")!.files.map((f) => f.path)).toEqual(["café.txt", "my notes.v2.md"]);
  });
  test("over a limit the skill has no files and is marked too large: one file, the count, or the total", () => {
    expect(folders([blob("a/SKILL.md"), blob("a/big.bin", 1_000_001)]).get("a")).toMatchObject({
      files: [],
      tooLarge: true,
    });
    const many = Array.from({ length: 201 }, (_, i) => blob(`a/f${i}.txt`, 1));
    expect(folders([blob("a/SKILL.md"), ...many]).get("a")).toMatchObject({
      files: [],
      tooLarge: true,
    });
    const heavy = Array.from({ length: 5 }, (_, i) => blob(`a/h${i}.bin`, 900_000));
    expect(folders([blob("a/SKILL.md"), ...heavy]).get("a")).toMatchObject({
      files: [],
      tooLarge: true,
    });
    expect(folders([blob("a/SKILL.md"), blob("a/ok.bin", 1_000_000)]).get("a")).toMatchObject({
      tooLarge: false,
    });
  });
});

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
    expect(readSkill(file("description: d", "x".repeat(64_001)), "x").warnings).toEqual([
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
  test("a body up to 64 KB is fine; hashes and token assignments in examples are not secrets, a key format is", () => {
    expect(readSkill(file("description: d", "x".repeat(64_000)), "x").warnings).toEqual([]);
    const examples = "token = os.environ['TOKEN']\ncommit 0123456789abcdef0123456789abcdef01234567";
    expect(readSkill(file("description: d", examples), "x").warnings).toEqual([]);
    expect(readSkill(file("description: d", "-----BEGIN PRIVATE KEY-----"), "x").warnings).toEqual([
      "looks_secret",
    ]);
  });
});

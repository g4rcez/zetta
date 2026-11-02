import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hostSkill, hostSkillFiles, hostSkills, parseSkillFile } from "./host-skills";

describe("parseSkillFile", () => {
  test("reads the description and the body after the frontmatter", () => {
    expect(
      parseSkillFile('---\nname: x\ndescription: "Write release notes"\n---\n\n1) list the PRs\n'),
    ).toEqual({ description: "Write release notes", body: "1) list the PRs" });
  });
  test("reads a folded description over several lines", () => {
    expect(
      parseSkillFile(
        "---\nname: x\ndescription: >-\n  Write release\n  notes fast\nother: 1\n---\nBody",
      ),
    ).toEqual({ description: "Write release notes fast", body: "Body" });
  });
  test("without frontmatter the first line describes the skill", () => {
    expect(parseSkillFile("Do the thing.\nThen stop.")).toEqual({
      description: "Do the thing.",
      body: "Do the thing.\nThen stop.",
    });
  });
  test("a skill with shell injection, an empty one and a huge one are refused", () => {
    expect(parseSkillFile("---\ndescription: d\n---\nRun !`id` now")).toBeUndefined();
    expect(parseSkillFile("---\ndescription: d\n---\n")).toBeUndefined();
    expect(parseSkillFile(`---\ndescription: d\n---\n${"x".repeat(24_001)}`)).toBeUndefined();
  });
});

describe("hostSkills", () => {
  let home = "";
  const on = { ZETTA_HOST_SKILLS: "on" };
  const add = async (dir: string, name: string, text: string) => {
    await mkdir(join(home, dir, name), { recursive: true });
    await writeFile(join(home, dir, name, "SKILL.md"), text);
  };
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "zetta-host-skills-"));
    await add(
      ".claude/skills",
      "from-claude",
      "---\ndescription: In the Claude folder\n---\nClaude steps",
    );
    await add(".claude/skills", "both", "---\ndescription: Claude copy\n---\nClaude copy steps");
    await add(".agents/skills", "both", "---\ndescription: Agents copy\n---\nAgents copy steps");
    await add(
      ".agents/skills",
      "from-agents",
      "---\ndescription: In the shared folder\n---\nShared steps",
    );
    await add(".agents/skills", "Bad_Name", "---\ndescription: d\n---\nIgnored");
    await add(".agents/skills", "injected", "---\ndescription: d\n---\nRun !`id`");
    await mkdir(join(home, ".agents/skills", "no-file"), { recursive: true });
    await mkdir(join(home, "elsewhere", "linked"), { recursive: true });
    await writeFile(
      join(home, "elsewhere", "linked", "SKILL.md"),
      "---\ndescription: Linked\n---\nLinked steps",
    );
    await symlink(join(home, "elsewhere", "linked"), join(home, ".agents/skills", "linked"));
  });
  afterAll(() => rm(home, { recursive: true, force: true }));

  test("lists nothing unless ZETTA_HOST_SKILLS is on", async () => {
    expect(await hostSkills({ home, env: {} })).toEqual([]);
    expect(await hostSkills({ home, env: { ZETTA_HOST_SKILLS: "yes" } })).toEqual([]);
  });
  test("lists both folders, the Claude one first, and a name found twice once from the Claude folder", async () => {
    const list = await hostSkills({ home, env: on });
    expect(list.map((k) => [k.name, k.root])).toEqual([
      ["both", "claude"],
      ["from-claude", "claude"],
      ["from-agents", "agents"],
      ["linked", "agents"],
    ]);
    expect(list.find((k) => k.name === "both")?.description).toBe("Claude copy");
  });
  test("skips invalid names, folders without SKILL.md and skills with shell injection", async () => {
    const names = (await hostSkills({ home, env: on })).map((k) => k.name);
    expect(names).not.toContain("Bad_Name");
    expect(names).not.toContain("no-file");
    expect(names).not.toContain("injected");
  });
  test("reads one skill with the folder it sits in, and no text", async () => {
    expect(await hostSkill("from-agents", { home, env: on })).toEqual({
      name: "from-agents",
      root: "agents",
      description: "In the shared folder",
      dir: join(home, ".agents/skills", "from-agents"),
    });
    expect(await hostSkill("nope", { home, env: on })).toBeUndefined();
  });
  test("gives a skill as a plugin file with its whole SKILL.md", async () => {
    const skill = (await hostSkill("from-agents", { home, env: on }))!;
    expect(await hostSkillFiles(skill)).toEqual({
      "skills/from-agents/SKILL.md": "---\ndescription: In the shared folder\n---\nShared steps",
    });
  });
  test("a missing home folder gives an empty list", async () => {
    expect(await hostSkills({ home: join(home, "none"), env: on })).toEqual([]);
  });
});

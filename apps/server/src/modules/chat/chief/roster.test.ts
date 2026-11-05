import { expect, test } from "bun:test";
import { chiefRoster } from "./roster";

const bot = (
  id: string,
  name: string,
  extra: Partial<Parameters<typeof chiefRoster>[0][number]> = {},
) => ({
  id,
  name,
  kind: "specialist" as const,
  harness: "codex",
  description: "",
  ...extra,
});

test("one line per bot with engine, description, skills and teams", () => {
  const text = chiefRoster(
    [bot("b1", "Scout", { description: "finds sources" })],
    [
      { botId: "b1", name: "web-research" },
      { botId: "b1", name: "interview-me" },
    ],
    [
      { botId: "b1", team: "Launch", role: "Researcher" },
      { botId: "b1", team: "Docs", role: "" },
    ],
  );
  expect(text).toBe(
    "- Scout (b1) codex: finds sources | skills: web-research, interview-me | teams: Launch/Researcher, Docs",
  );
});

test("a bot with nothing else is just its name, id and engine", () => {
  expect(chiefRoster([bot("b1", "Scout")], [], [])).toBe("- Scout (b1) codex");
});

test("the chief is left out", () => {
  expect(chiefRoster([bot("c", "Zetta", { kind: "chief" }), bot("b1", "Scout")], [], [])).toBe(
    "- Scout (b1) codex",
  );
});

test("a long description is collapsed, cleaned and cut", () => {
  const text = chiefRoster(
    [bot("b1", "Scout", { description: `line one\n\n\`\`\`code\`\`\`   ${"x".repeat(200)}` })],
    [],
    [],
  );
  expect(text).not.toContain("\n");
  expect(text).not.toContain("`");
  expect(text.length).toBeLessThan(150);
  expect(text.endsWith("…")).toBe(true);
});

test("more than 5 skills and 3 teams are counted, not listed", () => {
  const skills = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ botId: "b1", name }));
  const teams = ["T1", "T2", "T3", "T4"].map((team) => ({ botId: "b1", team, role: "" }));
  expect(chiefRoster([bot("b1", "Scout")], skills, teams)).toBe(
    "- Scout (b1) codex | skills: a, b, c, d, e +2 | teams: T1, T2, T3 +1",
  );
});

test("more than 40 bots are cut with a pointer to zetta:bot list", () => {
  const bots = Array.from({ length: 43 }, (_, i) => bot(`b${i}`, `Bot${i}`));
  const lines = chiefRoster(bots, [], []).split("\n");
  expect(lines).toHaveLength(41);
  expect(lines.at(-1)).toBe("…3 more: use zetta:bot list");
});

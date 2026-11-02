import { expect, test } from "bun:test";
import { looksLikeSource } from "./source";

test("a repository or a link is browsed, a name or some words are searched", () => {
  expect(looksLikeSource("anthropics/skills")).toBe(true);
  expect(looksLikeSource("  https://github.com/mattpocock/skills ")).toBe(true);
  expect(looksLikeSource("github.com/cursor/plugins")).toBe(true);
  expect(looksLikeSource("https://skills.sh/vercel-labs/skills/find-skills")).toBe(true);
  expect(looksLikeSource("interview-me")).toBe(false);
  expect(looksLikeSource("interview me")).toBe(false);
  expect(looksLikeSource("pull request review")).toBe(false);
});

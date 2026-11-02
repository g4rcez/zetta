import { describe, expect, test } from "bun:test";
import { parseSource } from "./market";
import { SUGGESTIONS } from "./suggestions";

describe("suggestions", () => {
  test("lists the sources the owners named, each once", () => {
    const repos = SUGGESTIONS.map((s) => s.repo);
    expect(new Set(repos.map((r) => r.toLowerCase())).size).toBe(repos.length);
    expect(repos).toEqual(
      expect.arrayContaining(["addyosmani/agent-skills", "mattpocock/skills", "cursor/plugins"]),
    );
  });
  test("every source is a plain owner/repo and has a trust level and a reason to be there", () => {
    for (const s of SUGGESTIONS) {
      expect(parseSource(s.repo)).toEqual({
        owner: s.repo.split("/")[0]!,
        repo: s.repo.split("/")[1]!,
      });
      expect(["official", "trusted"]).toContain(s.trust);
      expect(s.blurb.length).toBeGreaterThan(10);
    }
  });
});

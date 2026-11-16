import { describe, expect, test } from "bun:test";
import {
  ENGINE_MATURITY,
  MATURITY,
  MATURITY_LEVELS,
  UNVERIFIED_ENGINES,
  engineMaturity,
} from "./maturity";

describe("maturity table", () => {
  test("every area that is not stable says what has not been proved", () => {
    for (const [name, m] of [...Object.entries(MATURITY), ...Object.entries(ENGINE_MATURITY)]) {
      expect(MATURITY_LEVELS).toContain(m.level);
      if (m.level !== "stable") expect(m.reason.length, name).toBeGreaterThan(10);
      else expect(m.reason, name).toBe("");
    }
  });

  test("the unverified engines are the ones that are not stable, and an unknown engine is experimental", () => {
    expect(UNVERIFIED_ENGINES).not.toContain("claude-code");
    expect(UNVERIFIED_ENGINES).toContain("codex");
    expect(engineMaturity("brand-new-cli").level).toBe("experimental");
    expect(engineMaturity("claude-code").level).toBe("stable");
  });
});

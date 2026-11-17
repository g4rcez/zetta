import { describe, expect, test } from "bun:test";

import { BOT_ROLE_FALLBACK_MAX, botRole } from "./bot-role";

describe("botRole", () => {
  test("the role the owner wrote wins, trimmed", () => {
    expect(
      botRole(
        { role: "  Support lead ", description: "Answers tickets", kind: "specialist" },
        "Seat",
      ),
    ).toBe("Support lead");
  });

  test("an empty or blank role falls to the seat title", () => {
    expect(botRole({ role: "   ", description: "Answers tickets" }, " Head of support ")).toBe(
      "Head of support",
    );
    expect(botRole({ description: "Answers tickets" }, "Head of support")).toBe("Head of support");
  });

  test("with no seat, the first non-empty line of the description", () => {
    expect(botRole({ description: "\n\n  Answers tickets.\nSecond line" })).toBe(
      "Answers tickets.",
    );
    expect(botRole({ description: "Windows\r\nline" })).toBe("Windows");
  });

  test("a long description line is cut with an ellipsis", () => {
    const out = botRole({ description: "a".repeat(200) });
    expect(out).toHaveLength(BOT_ROLE_FALLBACK_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(botRole({ description: "b".repeat(BOT_ROLE_FALLBACK_MAX) })).toBe(
      "b".repeat(BOT_ROLE_FALLBACK_MAX),
    );
  });

  test("with nothing else, the kind", () => {
    expect(botRole({ kind: "chief" })).toBe("Chief");
    expect(botRole({ kind: "specialist", description: "  \n " })).toBe("Specialist");
    expect(botRole({})).toBe("Specialist");
    expect(botRole({ role: null, description: null, kind: "chief" }, null)).toBe("Chief");
  });
});

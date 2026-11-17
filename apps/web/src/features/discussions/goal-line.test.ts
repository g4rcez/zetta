import { describe, expect, test } from "bun:test";

import { canEditRoom, goalLine } from "./room-description";

describe("the goal line in the room header", () => {
  test("it is the first line with words, as plain text", () => {
    expect(goalLine("")).toBe("");
    expect(goalLine("\n\n  Fix the login crash  \nthen test it")).toBe("Fix the login crash");
    expect(goalLine("## **Ship** the `launch` page")).toBe("Ship the launch page");
    expect(goalLine("- Read [the brief](https://example.invalid/b) first")).toBe(
      "Read the brief first",
    );
  });

  test("a mention reads as its name, not as the link behind it", () => {
    expect(goalLine("[@Dev](bot:01a1ce15-6b98-7fa6-a72d-0885e1cc5203) fixes the crash")).toBe(
      "@Dev fixes the crash",
    );
  });

  test("a code fence is skipped and a long line is cut with an ellipsis", () => {
    expect(goalLine("```\nnot this\n```\nThis")).toBe("not this");
    const cut = goalLine("a".repeat(300), 40);
    expect(cut).toHaveLength(40);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("who may change a room's words", () => {
  test("only the owner, and only while the room is open", () => {
    expect(canEditRoom({ status: "open" }, true)).toBe(true);
    expect(canEditRoom({ status: "paused" }, true)).toBe(true);
    expect(canEditRoom({ status: "stalled" }, true)).toBe(true);
    expect(canEditRoom({ status: "resolved" }, true)).toBe(false);
    expect(canEditRoom({ status: "cancelled" }, true)).toBe(false);
    expect(canEditRoom({ status: "open" }, false)).toBe(false);
  });
});

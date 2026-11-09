import { expect, test } from "bun:test";

import { BOT_TEMPLATES } from "./bot-templates";
import {
  composeInstructions,
  EMPTY_BRIEF,
  extractActions,
  reviewInstructions,
  reviewScore,
} from "./instruction-review";

test("an empty bot fails most checks", () => {
  const checks = reviewInstructions("", "");
  expect(checks.filter((c) => c.ok).map((c) => c.id)).toEqual(["vague"]);
});

test("flags vague filler with the phrase found", () => {
  const vague = reviewInstructions("", "Be helpful and do your best.").find(
    (c) => c.id === "vague",
  )!;
  expect(vague.ok).toBe(false);
  expect(vague.fix).toContain("Be helpful");
});

test("built-in templates pass every check", () => {
  for (const t of BOT_TEMPLATES)
    expect(reviewScore(reviewInstructions(t.personality, t.instructions))).toBe(100);
});

test("extracts one action per sentence or list item", () => {
  expect(
    extractActions(
      "1. Read the code first.\n- Keep diffs small. Add tests when you change behaviour.",
    ),
  ).toEqual(["Read the code first.", "Keep diffs small.", "Add tests when you change behaviour."]);
});

test("composes a brief into numbered instructions, skipping blanks", () => {
  const text = composeInstructions({
    ...EMPTY_BRIEF,
    job: "triage support tickets",
    steps: "read the ticket\n- tag it",
    never: "promise refunds",
  });
  expect(text).toBe(
    "Your job: triage support tickets.\n\nHow to work:\n1. read the ticket\n2. tag it\n\nNever: promise refunds.",
  );
  const checks = reviewInstructions("", text);
  expect(checks.find((c) => c.id === "steps")!.ok).toBe(true);
  expect(checks.find((c) => c.id === "boundaries")!.ok).toBe(true);
});

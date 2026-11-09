import { HARNESSES } from "@zetta/harness/models";
import type { Bot } from "./chat-client";

export { HARNESSES, isAllowedModel, modelOptions } from "@zetta/harness/models";
export const harnessOptions = HARNESSES.map((h) => ({
  value: h,
  label:
    h === "fixture"
      ? "fixture (offline test)"
      : h === "decision"
        ? "decision (Laya/Jev, no tokens)"
        : h === "claude-code"
          ? h
          : `${h} (not verified yet)`,
}));

/** Fields copied when duplicating a bot. Only what the owner can see is available (non-owners get blank personality/instructions). */
export function duplicateOf(b: Bot) {
  return {
    name: `${b.name} (copy)`,
    description: b.description,
    harness: b.harness,
    model: b.model ?? "",
    personality: b.personality,
    instructions: b.instructions,
    outputStyle: b.outputStyle ?? "default",
    outputStyleId: b.outputStyleId ?? null,
    visibility: b.visibility,
  };
}

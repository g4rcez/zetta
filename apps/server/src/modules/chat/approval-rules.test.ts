import { describe, expect, test } from "bun:test";

import { actionKeyOf, canRemember, ruleLabel } from "./approval-rules";

describe("approval rules", () => {
  test("grants, outside skills, host code, computers, questions and outside briefs are never remembered", () => {
    for (const kind of [
      "bot_permission",
      "install_skills",
      "publish_app",
      "create_vm",
      "tool_resume",
      "discussion_brief",
    ])
      expect(canRemember(kind, {})).toBe(false);
    expect(canRemember("create_routine", {})).toBe(true);
  });

  test("broad kinds are narrowed by what they do, and cannot be remembered without it", () => {
    expect(actionKeyOf("chief_action", { tool: "routine" })).toBe("routine");
    expect(canRemember("chief_action", {})).toBe(false);
    expect(
      actionKeyOf("bot_action", {
        calls: [{ kind: "task" }, { kind: "agenda" }, { kind: "task" }],
      }),
    ).toBe("agenda,task");
    expect(canRemember("bot_action", { calls: [] })).toBe(false);
    expect(ruleLabel("bot_action", "agenda,task")).toBe("Run: agenda,task");
  });
});

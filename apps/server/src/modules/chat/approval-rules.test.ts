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

  test("a company chart change is never remembered, while other chief tools still can be", () => {
    expect(canRemember("chief_action", { tool: "org" })).toBe(false);
    expect(canRemember("chief_action", { tool: "team" })).toBe(true);
  });

  test("adding or removing a person of a team is never remembered, while the rest of the team tool can be", () => {
    expect(actionKeyOf("chief_action", { tool: "team", op: "add_people" })).toBe("team:people");
    expect(canRemember("chief_action", { tool: "team", op: "add_people" })).toBe(false);
    expect(canRemember("chief_action", { tool: "team", op: "remove_people" })).toBe(false);
    expect(canRemember("chief_action", { tool: "team", op: "update" })).toBe(true);
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

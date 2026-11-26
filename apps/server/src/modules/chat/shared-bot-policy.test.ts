import { describe, expect, test } from "bun:test";
import { sharedVerdict, type SharedBot, type SharedCall } from "./shared-bot-policy";

const of = (who: SharedBot, kind: string, args: object = {}, more: Partial<SharedCall> = {}) =>
  sharedVerdict({ kind, args, ...more }, who);

describe("a bot someone else owns", () => {
  test("cannot touch the person's computers, accounts or bots", () => {
    for (const kind of ["desktop", "machine", "browser", "credential", "mcp", "create_vm"])
      expect(of("bot", kind, { action: "run" })).toBe("refuse");
    for (const kind of ["config", "permission", "bot_claude", "add_to_team", "create_team"])
      expect(of("bot", kind)).toBe("refuse");
    expect(of("bot", "skills", { action: "install" })).toBe("refuse");
    expect(of("bot", "plugin", { plugin: "github", tool: "list" }, { effect: "read" })).toBe(
      "refuse",
    );
  });

  test("reads and speaks", () => {
    for (const [kind, action] of [
      ["memory", "search"],
      ["task", "list"],
      ["agenda", "list"],
      ["playground", "get"],
      ["app", "guide"],
      ["skills", "search"],
    ])
      expect(of("bot", kind!, { action })).toBe("allow");
    expect(of("bot", "poll", { action: "create" })).toBe("allow");
    expect(of("bot", "plugin", { plugin: "mailbox" }, { effect: "read" })).toBe("allow");
  });

  test("every lasting write waits for the person", () => {
    for (const [kind, action] of [
      ["task", "add"],
      ["assign", undefined],
      ["agenda", "add"],
      ["my_routine", "create"],
      ["playground", "create"],
      ["app", "create"],
      ["artifact", undefined],
      ["discussion", "open"],
      ["discussion", "post"],
      ["escalate", undefined],
      ["handoff", undefined],
      ["memory", "suggest"],
    ])
      expect(of("bot", kind!, { action })).toBe("hold");
    expect(of("bot", "plugin", { plugin: "x" }, { effect: "send" })).toBe("hold");
    expect(of("bot", "plugin", { plugin: "x" })).toBe("hold");
    // A kind added later waits too.
    expect(of("bot", "something_new")).toBe("hold");
  });

  test("keeps the calls that make their own card", () => {
    for (const kind of ["create_bot", "create_routine", "create_workflow", "goal"])
      expect(of("bot", kind)).toBe("card");
    expect(of("bot", "memory", { action: "write" })).toBe("card");
  });
});

describe("the person's own bot beside someone else's", () => {
  test("runs nothing on a computer and asks before it writes", () => {
    for (const kind of ["desktop", "machine", "browser", "credential", "mcp"])
      expect(of("nearby", kind, { action: "run" })).toBe("refuse");
    expect(of("nearby", "task", { action: "add" })).toBe("hold");
    expect(of("nearby", "config")).toBe("card");
    expect(of("nearby", "plugin", { plugin: "github" }, { effect: "read" })).toBe("allow");
    // The Chief's own changes are cards already.
    expect(of("nearby", "routine", { action: "create" }, { chief: true })).toBe("allow");
    expect(of("nearby", "create_bot")).toBe("card");
  });
});

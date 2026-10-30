import { describe, expect, test } from "bun:test";
import { codeEnabled } from "./pipeline";

const shared = { codeAccess: true, harness: "claude-code", ownerUserId: "owner" } as const;

describe("code access", () => {
  test("the owner's bot runs code for the owner", () => {
    expect(codeEnabled(shared, "owner")).toBe(true);
  });
  test("a bot shared by someone else never runs code in the asker's workspace", () => {
    expect(codeEnabled(shared, "teammate")).toBe(false);
  });
});

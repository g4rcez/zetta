import { describe, expect, test } from "bun:test";

import { slowTurnCommand } from "./slow-turn";

describe("slowTurnCommand", () => {
  test("the three commands are read when alone in the text box", () => {
    expect(slowTurnCommand("/stop")).toBe("stop");
    expect(slowTurnCommand("  /Wrap-up  ")).toBe("wrap-up");
    expect(slowTurnCommand("/wait\n")).toBe("wait");
  });
  test("other text is a normal message", () => {
    expect(slowTurnCommand("please /stop the build")).toBeUndefined();
    expect(slowTurnCommand("/stop everything")).toBeUndefined();
    expect(slowTurnCommand("/stopper")).toBeUndefined();
    expect(slowTurnCommand("stop")).toBeUndefined();
  });
});

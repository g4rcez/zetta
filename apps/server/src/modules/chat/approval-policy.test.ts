import { describe, expect, test } from "bun:test";

import { writeMode, type WriteFacts } from "./approval-policy";

const facts = (over: Partial<WriteFacts> = {}): WriteFacts => ({
  seenOutside: false,
  reach: true,
  place: "chat",
  startedBy: "user_message",
  askedToKeep: false,
  ...over,
});

describe("writeMode", () => {
  test("the person's own message applies, also for a bot with code access, with no magic word", () => {
    expect(writeMode(facts())).toBe("apply");
    expect(writeMode(facts({ askedToKeep: true }))).toBe("apply");
  });

  test("outside content the server saw always asks, whatever else is true", () => {
    for (const place of ["chat", "loop", "room", "inbound"] as const)
      for (const startedBy of ["user_message", "server"] as const)
        for (const reach of [true, false])
          for (const askedToKeep of [true, false])
            expect(writeMode({ seenOutside: true, reach, place, startedBy, askedToKeep })).toBe(
              "ask",
            );
  });

  test("a bot with no code access and no MCP applies everywhere: the server sees all it reads", () => {
    for (const place of ["chat", "loop", "room", "inbound"] as const)
      for (const startedBy of ["user_message", "server"] as const)
        expect(writeMode(facts({ reach: false, place, startedBy }))).toBe("apply");
  });

  test("loops, rooms and inbound chats ask for a bot with reach, even on the person's own post", () => {
    for (const place of ["loop", "room", "inbound"] as const)
      for (const startedBy of ["user_message", "server"] as const)
        expect(writeMode(facts({ place, startedBy, askedToKeep: true }))).toBe("ask");
  });

  test("a turn Zetta started in a chat (a routine run) applies only what its prompt asks to keep", () => {
    expect(writeMode(facts({ startedBy: "server" }))).toBe("ask");
    expect(writeMode(facts({ startedBy: "server", askedToKeep: true }))).toBe("apply");
  });
});

import { describe, expect, test } from "bun:test";
import { pluginTurnOf, type PluginTurn, type TurnFacts } from "./turn";

const facts = (over: Partial<TurnFacts> = {}): TurnFacts => ({
  inbound: false,
  room: false,
  loop: false,
  startedBy: "user_message",
  outsideInput: false,
  ...over,
});

describe("where a turn runs", () => {
  const table: [string, Partial<TurnFacts>, PluginTurn][] = [
    ["the person typed in their own chat", {}, "chat"],
    ["a routine run, a notice or a resumed run", { startedBy: "server" }, "server"],
    ["a step of an approved goal loop", { loop: true, startedBy: "server" }, "loop"],
    [
      "a routine started by a webhook",
      { startedBy: "server", outsideInput: true },
      "outside_event",
    ],
    [
      "a memory job with a source file",
      { startedBy: "server", outsideInput: true },
      "outside_event",
    ],
    ["an outside person wrote to the bot", { inbound: true, startedBy: "server" }, "inbound"],
    ["a room", { room: true }, "room"],
    ["a loop step inside a room", { room: true, loop: true }, "room"],
    ["an inbound chat that is also a loop", { inbound: true, loop: true }, "inbound"],
    ["an outside event in a loop", { loop: true, outsideInput: true }, "outside_event"],
  ];
  for (const [name, over, want] of table)
    test(name, () => expect(pluginTurnOf(facts(over))).toBe(want));
});

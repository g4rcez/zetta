import { describe, expect, test } from "bun:test";

import type { PollView, PollVotes } from "./chat-client";
import { applyVote, mineOf, nextSelection, pollBody, totalVotes } from "./poll-votes";

const poll = (mode: PollView["mode"] = "single"): PollView => ({
  question: "Lunch?",
  mode,
  status: "open",
  options: [
    { id: "a", label: "Pizza" },
    { id: "b", label: "Sushi" },
    { id: "c", label: "Salad" },
  ],
});

describe("nextSelection", () => {
  test("one choice: a click picks the option, and a click on the picked one takes it back", () => {
    expect(nextSelection(poll(), {}, "a")).toEqual(["a"]);
    expect(nextSelection(poll(), { a: { count: 1, mine: true, botIds: [] } }, "b")).toEqual(["b"]);
    expect(nextSelection(poll(), { a: { count: 1, mine: true, botIds: [] } }, "a")).toEqual([]);
  });
  test("several choices: a click adds the option, or removes it when it was picked", () => {
    const votes: PollVotes = { a: { count: 1, mine: true, botIds: [] } };
    expect(nextSelection(poll("multiple"), votes, "b")).toEqual(["a", "b"]);
    expect(nextSelection(poll("multiple"), votes, "a")).toEqual([]);
  });
});

describe("applyVote", () => {
  test("moves the viewer's vote and leaves other voters alone", () => {
    const before: PollVotes = {
      a: { count: 3, mine: true, botIds: ["bot1"] },
      b: { count: 1, mine: false, botIds: [] },
    };
    const after = applyVote(before, ["b"]);
    expect(after.a).toEqual({ count: 2, mine: false, botIds: ["bot1"] });
    expect(after.b).toEqual({ count: 2, mine: true, botIds: [] });
  });
  test("an option nobody else picked disappears when the viewer leaves it", () => {
    const after = applyVote({ a: { count: 1, mine: true, botIds: [] } }, []);
    expect(after).toEqual({});
  });
  test("a bot's vote keeps its option listed", () => {
    const after = applyVote({ a: { count: 1, mine: true, botIds: ["b"] } }, []);
    expect(after.a).toEqual({ count: 0, mine: false, botIds: ["b"] });
  });
  test("does not change what it was given", () => {
    const before: PollVotes = { a: { count: 1, mine: true, botIds: [] } };
    applyVote(before, ["b"]);
    expect(before).toEqual({ a: { count: 1, mine: true, botIds: [] } });
  });
});

describe("totals", () => {
  test("count every cast vote", () => {
    expect(
      totalVotes({
        a: { count: 2, mine: false, botIds: [] },
        b: { count: 3, mine: true, botIds: [] },
      }),
    ).toBe(5);
    expect(totalVotes({})).toBe(0);
  });
  test("mineOf lists what the viewer picked, in the poll's order", () => {
    expect(
      mineOf(poll("multiple"), {
        c: { count: 1, mine: true, botIds: [] },
        a: { count: 1, mine: true, botIds: [] },
      }),
    ).toEqual(["a", "c"]);
  });
  test("the poll body is the question with a mark", () =>
    expect(pollBody(poll())).toBe("📊 Lunch?"));
});

import { describe, expect, test } from "bun:test";

import type { Row } from "../chat/chat-rows";
import {
  busyIds,
  coveredRoom,
  MAX_FOLLOWED,
  nextFollowed,
  type StreamState,
  type TurnLite,
} from "./room-streams";

const turn = (id: string, status: string, at: number): TurnLite => ({
  id,
  status,
  createdAt: new Date(at).toISOString(),
});
const row = (id: string): Row => ({
  id,
  seq: Number.MAX_SAFE_INTEGER,
  role: "assistant",
  content: "",
  status: "running",
  createdAt: new Date(0).toISOString(),
});
const state = (busy: boolean, rows: Row[] = []): StreamState => ({ busy, rows });
const states = (entries: [string, StreamState][]) => new Map(entries);

describe("nextFollowed", () => {
  test("every running turn is followed, oldest first", () => {
    const turns = [turn("d", "running", 30), turn("b", "running", 10), turn("t", "queued", 40)];
    expect(nextFollowed([], turns, states([]))).toEqual(["b", "d"]);
  });

  test("a turn that starts keeps the ones already followed (the reported case)", () => {
    const backend = turn("backend", "running", 10);
    const live = states([["backend", state(true, [row("b1")])]]);
    const one = nextFollowed([], [backend], live);
    expect(one).toEqual(["backend"]);
    const two = nextFollowed(one, [turn("d1", "running", 20), backend], live);
    expect(two).toEqual(["backend", "d1"]);
    const three = nextFollowed(
      two,
      [turn("d2", "running", 30), turn("d1", "running", 20), backend],
      live,
    );
    expect(three).toEqual(["backend", "d1", "d2"]);
  });

  test("nothing changes: the same array comes back, so state does not re-render", () => {
    const turns = [turn("a", "running", 1)];
    const prev = ["a"];
    expect(nextFollowed(prev, turns, states([["a", state(true)]]))).toBe(prev);
  });

  test("a turn done in the database stays while its stream is busy or holds rows", () => {
    const turns = [turn("a", "done", 1)];
    expect(nextFollowed(["a"], turns, states([["a", state(true)]]))).toEqual(["a"]);
    expect(nextFollowed(["a"], turns, states([["a", state(false, [row("r")])]]))).toEqual(["a"]);
  });

  test("a turn that is done, idle and empty is dropped", () => {
    const turns = [turn("a", "done", 1), turn("b", "running", 2)];
    expect(nextFollowed(["a", "b"], turns, states([["a", state(false)]]))).toEqual(["b"]);
  });

  test("at most MAX_FOLLOWED live streams, the oldest turns first", () => {
    const turns = Array.from({ length: 5 }, (_, i) => turn(`t${i}`, "running", i));
    expect(MAX_FOLLOWED).toBe(3);
    expect(nextFollowed([], turns, states([]))).toEqual(["t0", "t1", "t2"]);
  });

  test("a finished turn that only lingers does not take a slot", () => {
    const turns = [
      turn("old", "done", 0),
      turn("a", "running", 1),
      turn("b", "running", 2),
      turn("c", "running", 3),
    ];
    const held = states([["old", state(false, [row("r")])]]);
    expect(nextFollowed(["old"], turns, held)).toEqual(["old", "a", "b", "c"]);
  });

  test("a followed turn is never dropped to make room for a newer one", () => {
    const turns = [
      turn("a", "running", 1),
      turn("b", "running", 2),
      turn("c", "running", 3),
      turn("d", "running", 4),
    ];
    const first = nextFollowed([], turns, states([]));
    expect(first).toEqual(["a", "b", "c"]);
    expect(nextFollowed(first, turns, states([]))).toEqual(["a", "b", "c"]);
  });
});

describe("coveredRoom", () => {
  test("covered when every open turn is running with an open stream", () => {
    const turns = [turn("a", "running", 1), turn("b", "running", 2)];
    expect(
      coveredRoom(
        turns,
        states([
          ["a", state(true)],
          ["b", state(true)],
        ]),
      ),
    ).toBe(true);
  });

  test("a queued turn keeps the fast poll", () => {
    const turns = [turn("a", "running", 1), turn("q", "queued", 2)];
    expect(coveredRoom(turns, states([["a", state(true)]]))).toBe(false);
  });

  test("a running turn without an open stream keeps the fast poll", () => {
    const turns = [turn("a", "running", 1), turn("b", "running", 2)];
    expect(
      coveredRoom(
        turns,
        states([
          ["a", state(true)],
          ["b", state(false)],
        ]),
      ),
    ).toBe(false);
  });

  test("no open stream is not covered", () => {
    expect(coveredRoom([turn("a", "running", 1)], states([]))).toBe(false);
  });
});

test("busyIds lists the open streams", () => {
  expect(
    busyIds(
      states([
        ["a", state(true)],
        ["b", state(false)],
      ]),
    ),
  ).toEqual(["a"]);
});

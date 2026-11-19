import { expect, test } from "bun:test";

import { onPoke, poke } from "./poke";

test("a poke wakes every listener of that turn, and only of that turn", () => {
  const a = new AbortController().signal;
  const b = new AbortController().signal;
  const woke: string[] = [];
  onPoke(a, () => woke.push("a1"));
  onPoke(a, () => woke.push("a2"));
  onPoke(b, () => woke.push("b"));
  expect(poke(a)).toBe(true);
  expect(woke).toEqual(["a1", "a2"]);
});

test("a poke with nobody listening does nothing", () => {
  expect(poke(new AbortController().signal)).toBe(false);
});

test("a listener that stopped is not woken, even when it stops while a poke runs", () => {
  const signal = new AbortController().signal;
  const woke: string[] = [];
  const stopSecond = onPoke(signal, () => woke.push("second"));
  onPoke(signal, () => {
    woke.push("first");
  });
  stopSecond();
  poke(signal);
  expect(woke).toEqual(["first"]);
  const stop = onPoke(signal, () => {
    woke.push("once");
    stop();
  });
  poke(signal);
  poke(signal);
  expect(woke.filter((w) => w === "once")).toHaveLength(1);
});

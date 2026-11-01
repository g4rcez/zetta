import { describe, expect, test } from "bun:test";

import { findFreeSpot, hintCode, isHintsShortcut } from "./keyboard-hints";

const keys = { altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, key: "", code: "" };

describe("hintCode", () => {
  test("runs from AA to ZZ and then stops", () => {
    expect(hintCode(0)).toBe("AA");
    expect(hintCode(25)).toBe("AZ");
    expect(hintCode(26)).toBe("BA");
    expect(hintCode(675)).toBe("ZZ");
    expect(hintCode(676)).toBeNull();
    expect(hintCode(-1)).toBeNull();
  });
});

describe("isHintsShortcut", () => {
  test("accepts Alt+Shift+/ by physical key, as macOS types ¿", () => {
    expect(
      isHintsShortcut({ ...keys, altKey: true, shiftKey: true, code: "Slash", key: "¿" }),
    ).toBe(true);
  });

  test("accepts Alt+Shift with a typed ? or /", () => {
    expect(isHintsShortcut({ ...keys, altKey: true, shiftKey: true, key: "?" })).toBe(true);
    expect(isHintsShortcut({ ...keys, altKey: true, shiftKey: true, key: "/" })).toBe(true);
  });

  test("rejects other modifier sets", () => {
    expect(isHintsShortcut({ ...keys, ctrlKey: true, code: "Slash", key: "/" })).toBe(false);
    expect(isHintsShortcut({ ...keys, altKey: true, code: "Slash", key: "/" })).toBe(false);
    expect(
      isHintsShortcut({ ...keys, metaKey: true, altKey: true, shiftKey: true, code: "Slash" }),
    ).toBe(false);
  });
});

describe("findFreeSpot", () => {
  // A label is 28 x 20 px.
  const left = { left: 68, top: 106, fits: true };
  const right = { left: 204, top: 106, fits: true };

  test("takes the first spot when nothing is in the way", () => {
    expect(findFreeSpot([left, right], [])).toEqual(left);
  });

  test("skips a spot outside the viewport", () => {
    expect(findFreeSpot([{ ...left, fits: false }, right], [])).toEqual(right);
  });

  test("skips a spot that covers another clickable element or label", () => {
    const neighbour = { left: 60, top: 100, right: 96, bottom: 140 };
    expect(findFreeSpot([left, right], [neighbour])).toEqual(right);
  });

  test("a box that only touches the label does not cover it", () => {
    const touching = { left: 96, top: 100, right: 120, bottom: 140 };
    expect(findFreeSpot([left], [touching])).toEqual(left);
  });

  test("returns nothing when every spot is taken", () => {
    const wall = { left: 0, top: 0, right: 400, bottom: 400 };
    expect(findFreeSpot([left, right], [wall])).toBeUndefined();
  });
});

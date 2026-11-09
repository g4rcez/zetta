import { describe, expect, test } from "bun:test";

import { barPath, compact, niceTicks, shorten, slicePath } from "./chart-math";

describe("niceTicks", () => {
  test("round steps that cover the data", () => {
    expect(niceTicks(0, 210)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-30, 90)[0]).toBeLessThanOrEqual(-30);
    expect(niceTicks(-30, 90).at(-1)).toBeGreaterThanOrEqual(90);
  });
  test("a flat or empty range still gives an axis", () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    const t = niceTicks(5, 5);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBeGreaterThanOrEqual(5);
  });
  test("no floating point noise", () => {
    expect(niceTicks(0, 0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });
});

describe("barPath", () => {
  test("a column is square at the baseline and rounded at the data end", () => {
    expect(barPath(10, 100, 40, 20)).toBe("M10,100V44Q10,40 14,40H26Q30,40 30,44V100Z");
  });
  test("a negative value rounds at the bottom", () => {
    expect(barPath(10, 100, 160, 20)).toBe("M10,100V156Q10,160 14,160H26Q30,160 30,156V100Z");
  });
  test("a tiny bar shrinks its radius, a zero bar draws nothing", () => {
    expect(barPath(0, 100, 99, 20)).toContain("V100");
    expect(barPath(0, 100, 100, 20)).toBe("");
  });
});

describe("slicePath", () => {
  test("a half circle uses the small arc flag, a whole circle is two arcs", () => {
    expect(slicePath(80, 80, 76, 0, 0.25)).toContain("A76,76 0 0 1");
    expect(slicePath(80, 80, 76, 0, 0.75)).toContain("A76,76 0 1 1");
    expect(slicePath(80, 80, 76, 0, 1).match(/A/g)).toHaveLength(2);
  });
});

describe("labels", () => {
  test("compact numbers and shortened categories", () => {
    expect(compact(12900)).toBe("12.9K");
    expect(compact(950)).toBe("950");
    expect(shorten("production-eu-west")).toBe("production-…");
    expect(shorten("short")).toBe("short");
  });
});

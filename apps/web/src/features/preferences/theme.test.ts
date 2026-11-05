import { describe, expect, test } from "bun:test";

import { contrast, lowestContrast, readableOn } from "./theme";

describe("contrast", () => {
  test("black on white is 21:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  test("the order of the two colors does not matter", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  test("the same color on itself is 1:1", () => {
    expect(contrast("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  test("gray #777777 on white is 4.48:1, just under the 4.5:1 of AA", () => {
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("lowestContrast", () => {
  test("is the weakest of the grounds", () => {
    expect(lowestContrast("#777777", ["#ffffff", "#000000"])).toBeCloseTo(4.48, 2);
  });
});

describe("readableOn", () => {
  test("a dark color gets white text", () => {
    expect(readableOn("#003366")).toBe("#ffffff");
  });

  test("a light color gets the dark ink", () => {
    expect(readableOn("#ffff66")).toBe("#09090b");
  });
});

import { describe, expect, test } from "bun:test";

import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
  test("has version 7 and the RFC variant", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("starts with the timestamp in milliseconds", () => {
    expect(uuidv7(0x01a17f88e630).startsWith("01a17f88-e630-7")).toBe(true);
  });

  test("sorts by time", () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });
});

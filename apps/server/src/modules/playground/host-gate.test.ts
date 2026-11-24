import { describe, expect, test } from "bun:test";
import { pickRunner } from "./host-gate";
import type { Runner } from "./types";

const fake: Runner = async () => {
  throw new Error("not called");
};
const other: Runner = async () => {
  throw new Error("not called");
};

describe("pickRunner", () => {
  test("allows the host runner when the switch is on", () => {
    expect(pickRunner({ host: fake }, "host", () => true)).toEqual({ runner: fake });
  });
  test("refuses the host runner when the switch is off", () => {
    expect(pickRunner({ host: fake }, "host", () => false)).toEqual({ refused: "host_off" });
  });
  test("never blocks the container runner", () => {
    expect(pickRunner({ host: fake, container: other }, "container", () => false)).toEqual({
      runner: other,
    });
  });
  test("reports a runner that is not set up", () => {
    expect(pickRunner({ host: fake }, "container", () => true)).toEqual({ refused: "not_set_up" });
  });
});

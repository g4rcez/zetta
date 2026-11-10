import { describe, expect, test } from "bun:test";
import { hostCodeFromEnv, pickRunner, refusal } from "./host-gate";
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

describe("hostCodeFromEnv", () => {
  test("follows ZETTA_CODE_ACCESS", () => {
    const saved = process.env.ZETTA_CODE_ACCESS;
    try {
      process.env.ZETTA_CODE_ACCESS = "off";
      expect(hostCodeFromEnv()).toBe(false);
      process.env.ZETTA_CODE_ACCESS = "host";
      expect(hostCodeFromEnv()).toBe(true);
      delete process.env.ZETTA_CODE_ACCESS;
      expect(hostCodeFromEnv()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.ZETTA_CODE_ACCESS;
      else process.env.ZETTA_CODE_ACCESS = saved;
    }
  });
});

describe("refusal", () => {
  test("says what was refused", () => {
    expect(refusal("host_off", "host")).toContain("turned off");
    expect(refusal("not_set_up", "container")).toBe(
      "The container runner is not set up on this server.",
    );
  });
});

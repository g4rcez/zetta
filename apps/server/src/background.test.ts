import { describe, expect, test } from "bun:test";

import { createBackground } from "./background";

const setup = () => {
  const lines: string[] = [];
  let clock = 0;
  const background = createBackground(
    (line) => lines.push(line),
    () => clock,
  );
  return {
    lines,
    background,
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

describe("createBackground", () => {
  test("run resolves true and logs nothing when the unit succeeds", async () => {
    const { background, lines } = setup();
    expect(await background.run("jobs", async () => {})).toBe(true);
    expect(lines).toEqual([]);
  });

  test("run resolves false and does not reject when the unit throws or rejects", async () => {
    const { background, lines, advance } = setup();
    expect(
      await background.run("sync", () => {
        throw new Error("boom");
      }),
    ).toBe(false);
    advance(60_000);
    expect(await background.run("sync", () => Promise.reject(new Error("boom")))).toBe(false);
    expect(lines).toHaveLength(2);
  });

  test("logs the unit and the error class, never the message", async () => {
    const { background, lines } = setup();
    await background.run("jobs", () => {
      throw new TypeError("secret text");
    });
    expect(lines).toEqual(["background: jobs failed name=TypeError"]);
    expect(lines.some((l) => l.includes("secret text"))).toBe(false);
  });

  test("a thrown non-error logs its typeof", async () => {
    const { background, lines } = setup();
    await background.run("jobs", () => {
      throw "x";
    });
    expect(lines).toEqual(["background: jobs failed name=string"]);
  });

  test("logs a unit at most once a minute, and each unit on its own", async () => {
    const { background, lines, advance } = setup();
    const fail = () => {
      throw new Error("down");
    };
    await background.run("jobs", fail);
    await background.run("jobs", fail);
    expect(lines).toHaveLength(1);
    await background.run("other", fail);
    expect(lines).toHaveLength(2);
    advance(60_000);
    await background.run("jobs", fail);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("background: jobs failed name=Error");
  });

  test("exclusive skips a call that arrives while the unit is still going", async () => {
    const { background } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = background.exclusive("recover", () => gate);
    let secondCalled = false;
    const second = await background.exclusive("recover", () => {
      secondCalled = true;
    });
    expect(second).toBe(false);
    expect(secondCalled).toBe(false);
    release();
    expect(await first).toBe(true);
    let thirdCalled = false;
    const third = await background.exclusive("recover", () => {
      thirdCalled = true;
    });
    expect(third).toBe(true);
    expect(thirdCalled).toBe(true);
  });
});

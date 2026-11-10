import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireInstanceLock, type InstanceLock } from "./single-instance";

let dir = "";
const held: InstanceLock[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zetta-instance-"));
});
afterEach(() => {
  for (const lock of held.splice(0)) lock.release();
  rmSync(dir, { recursive: true, force: true });
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("single instance", () => {
  test("the first launch gets the lock and keeps it private", async () => {
    const lock = await acquireInstanceLock(dir, [], () => {});
    expect(lock).not.toBeNull();
    held.push(lock!);
    if (process.platform !== "win32")
      expect(statSync(join(dir, "instance.lock")).mode & 0o777).toBe(0o600);
  });

  test("a second launch hands its arguments to the first and gets no lock", async () => {
    const seen: string[][] = [];
    held.push((await acquireInstanceLock(dir, [], (argv) => seen.push(argv)))!);
    const second = await acquireInstanceLock(
      dir,
      ["zetta://open?server=https%3A%2F%2Fa.invalid"],
      () => {},
    );
    expect(second).toBeNull();
    await wait(20);
    expect(seen).toEqual([["zetta://open?server=https%3A%2F%2Fa.invalid"]]);
  });

  test("releasing the lock lets the next launch take it", async () => {
    const first = (await acquireInstanceLock(dir, [], () => {}))!;
    first.release();
    expect(existsSync(join(dir, "instance.lock"))).toBe(false);
    const next = await acquireInstanceLock(dir, [], () => {});
    expect(next).not.toBeNull();
    held.push(next!);
  });

  test("a lock left by a crashed instance is replaced", async () => {
    writeFileSync(join(dir, "instance.lock"), JSON.stringify({ pid: 1, port: 9, token: "stale" }));
    const lock = await acquireInstanceLock(dir, [], () => {}, 300);
    expect(lock).not.toBeNull();
    held.push(lock!);
  });

  test("a lock file that is not ours is replaced too", async () => {
    writeFileSync(join(dir, "instance.lock"), "garbage");
    const lock = await acquireInstanceLock(dir, [], () => {}, 300);
    expect(lock).not.toBeNull();
    held.push(lock!);
  });

  test("ignores a message that carries the wrong token", async () => {
    const seen: string[][] = [];
    held.push((await acquireInstanceLock(dir, [], (argv) => seen.push(argv)))!);
    const lock = JSON.parse(await Bun.file(join(dir, "instance.lock")).text()) as { port: number };
    await new Promise<void>((resolve) => {
      Bun.connect({
        hostname: "127.0.0.1",
        port: lock.port,
        socket: {
          open(socket) {
            socket.write(`${JSON.stringify({ token: "wrong", argv: ["x"] })}\n`);
          },
          close: () => resolve(),
          data: () => {},
          error: () => resolve(),
        },
      });
    });
    expect(seen).toEqual([]);
  });
});

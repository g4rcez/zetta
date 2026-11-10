import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  beginStep,
  closeLiveRun,
  createLiveDir,
  endStep,
  findStep,
  followStep,
  LIVE_SHELL,
  lastOutputAt,
  openLiveRun,
  scrub,
  secretValues,
  stripAnsi,
} from "./step-output";

const dirs: string[] = [];
const root = async () => {
  const d = await mkdtemp(join(tmpdir(), "zetta-live-test-"));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const collect = async (gen: AsyncGenerator<string, void>) => {
  let out = "";
  for await (const chunk of gen) out += chunk;
  return out;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("scrub", () => {
  test("strips colors and hyperlinks, masks tokens and the exact secret values", () => {
    const raw =
      "\u001b[31mred\u001b[0m \u001b]8;;file:///x\u0007link\u001b]8;;\u0007 sk-abcdefghijkl and hunter2hunter2 end";
    expect(stripAnsi(raw)).toBe("red link sk-abcdefghijkl and hunter2hunter2 end");
    expect(scrub(raw, ["hunter2hunter2"])).toBe("red link [redacted] and [redacted] end");
  });
  test("only long values of the run environment count as secrets", () => {
    expect(secretValues({ LANG: "C", API_KEY: "abcdefghij", A: "1" })).toEqual(["abcdefghij"]);
  });
});

describe("live steps", () => {
  test("a command is matched to its step by text, even with quoting around it", async () => {
    const dir = await root();
    const run = openLiveRun(undefined, dir, []);
    beginStep(run, "t1", "echo 'it works'; sleep 1");
    beginStep(run, "t2", "ls -la");
    // The wrapper recorded the second command first: matching is by text, not by order.
    await writeFile(
      join(dir, "9-2.cmd"),
      `source x && eval 'ls -la' < /dev/null && pwd -P >| /tmp/c`,
    );
    await writeFile(
      join(dir, "9-1.cmd"),
      `source x && eval 'echo '\\''it works'\\''; sleep 1' < /dev/null && pwd -P >| /tmp/c`,
    );
    await endStep(run, "t1");
    expect(run.steps.get("t1")?.file).toBe(join(dir, "9-1.out"));
    expect(run.steps.get("t2")?.file).toBe(join(dir, "9-2.out"));
  });

  test("what the text does not tell is paired by order", async () => {
    const dir = await root();
    const run = openLiveRun(undefined, dir, []);
    beginStep(run, "t1", "echo $'weird'");
    await writeFile(join(dir, "5-1.cmd"), "eval something-else");
    await endStep(run, "t1");
    expect(run.steps.get("t1")?.file).toBe(join(dir, "5-1.out"));
  });

  test("a step is found through the abort signal of its turn", async () => {
    const dir = await root();
    const abort = new AbortController();
    const run = openLiveRun(abort.signal, dir, []);
    beginStep(run, "t1", "ls");
    expect(findStep(abort.signal, "t1")?.run).toBe(run);
    expect(findStep(abort.signal, "nope")).toBeUndefined();
    expect(findStep(new AbortController().signal, "t1")).toBeUndefined();
  });

  test("follow streams what is written while the step runs and ends when it is done", async () => {
    const dir = await root();
    const run = openLiveRun(undefined, dir, ["supersecret"]);
    beginStep(run, "t1", "make");
    await writeFile(join(dir, "1-1.cmd"), "eval 'make'");
    await writeFile(join(dir, "1-1.out"), "one\ntwo \u001b[32mgreen\u001b[0m\n");
    const step = run.steps.get("t1")!;
    const seen = collect(followStep(run, step, undefined, { pollMs: 10, idleMs: 40 }));
    await wait(60);
    await writeFile(
      join(dir, "1-1.out"),
      "one\ntwo \u001b[32mgreen\u001b[0m\nkey=supersecret\npart",
      {
        flag: "w",
      },
    );
    await wait(60);
    await endStep(run, "t1");
    expect(await seen).toBe("one\ntwo green\nkey=[redacted]\npart");
  });

  test("a long output starts near its end", async () => {
    const dir = await root();
    const run = openLiveRun(undefined, dir, []);
    beginStep(run, "t1", "cat big");
    await writeFile(join(dir, "1-1.cmd"), "eval 'cat big'");
    await writeFile(join(dir, "1-1.out"), `${"x".repeat(100)}\n`.repeat(2000));
    await endStep(run, "t1");
    const text = await collect(followStep(run, run.steps.get("t1")!, undefined, { pollMs: 10 }));
    expect(text.startsWith("[earlier output not shown]\n")).toBe(true);
    expect(text.length).toBeLessThan(70_000);
  });

  test("a step that never ran ends empty when the run closes", async () => {
    const dir = await root();
    const run = openLiveRun(undefined, dir, []);
    beginStep(run, "t1", "never");
    closeLiveRun(run);
    expect(await collect(followStep(run, run.steps.get("t1")!, undefined, { pollMs: 10 }))).toBe(
      "",
    );
  });
});

describe.skipIf(process.platform === "win32")("the wrapper", () => {
  const run = async (dir: string, command: string, env: Record<string, string> = {}) => {
    const p = Bun.spawn([join(dir, LIVE_SHELL), command], {
      env: { PATH: process.env.PATH ?? "", SHELL: "/bin/bash", ZETTA_LIVE_DIR: dir, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out, err, code };
  };
  const files = async (dir: string, ext: string) =>
    (await Array.fromAsync(new Bun.Glob(`*.${ext}`).scan(dir))).sort();

  test("a Bash-tool command keeps its streams and status, and is copied to a file", async () => {
    const dir = await createLiveDir(await root());
    const cmd = "echo out-line; echo err-line >&2; exit 3; pwd -P >| /dev/null";
    const r = await run(dir, cmd);
    expect(r).toEqual({ out: "out-line\n", err: "err-line\n", code: 3 });
    const [name] = await files(dir, "out");
    const text = await Bun.file(join(dir, name!)).text();
    expect(text.split("\n").filter(Boolean).sort()).toEqual(["err-line", "out-line"]);
    expect(await Bun.file(join(dir, name!.replace(/\.out$/, ".cmd"))).text()).toBe(cmd);
  });

  test("a command that is not a Bash-tool command (a hook, an MCP server) is not copied", async () => {
    const dir = await createLiveDir(await root());
    const r = await run(dir, "echo hook-output; exit 4");
    expect(r).toEqual({ out: "hook-output\n", err: "", code: 4 });
    expect(await files(dir, "cmd")).toEqual([]);
  });

  test("output reaches the file while the command still runs", async () => {
    const dir = await createLiveDir(await root());
    const p = Bun.spawn(
      [join(dir, LIVE_SHELL), "echo first; sleep 2; echo second; pwd -P >| /dev/null"],
      {
        env: { PATH: process.env.PATH ?? "", SHELL: "/bin/bash", ZETTA_LIVE_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await wait(800);
    const [name] = await files(dir, "out");
    expect(await Bun.file(join(dir, name!)).text()).toBe("first\n");
    expect(p.exitCode).toBeNull();
    await p.exited;
  });

  test("a program that prints far past the cap does not block, and the file stays small", async () => {
    const dir = await createLiveDir(await root());
    const r = await run(dir, "head -c 3000000 /dev/zero | tr '\\0' x; pwd -P >| /dev/null");
    expect(r.out.length).toBe(3_000_000);
    const [name] = await files(dir, "out");
    expect((await Bun.file(join(dir, name!)).text()).length).toBe(1_048_576);
  });
});

describe("lastOutputAt", () => {
  test("is the newest time a command of the turn printed or started, and nothing for an unknown turn", async () => {
    const signal = new AbortController().signal;
    expect(await lastOutputAt(signal)).toBeUndefined();
    const dir = await createLiveDir(await root());
    const run = openLiveRun(signal, dir, []);
    expect(await lastOutputAt(signal)).toBeUndefined();
    await writeFile(join(dir, "1.cmd"), "sleep 1");
    await writeFile(join(dir, "1.out"), "first\n");
    const old = new Date(Date.now() - 60_000);
    await utimes(join(dir, "1.cmd"), old, old);
    await utimes(join(dir, "1.out"), old, old);
    await writeFile(join(dir, "2.out"), "still printing\n");
    expect(await lastOutputAt(signal)).toBe((await stat(join(dir, "2.out"))).mtimeMs);
    // A finished run says nothing: its folder is about to be removed.
    closeLiveRun(run);
    expect(await lastOutputAt(signal)).toBeUndefined();
  });
});

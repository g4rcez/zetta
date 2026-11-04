import { describe, expect, test } from "bun:test";

import {
  descendants,
  listProcesses,
  parseDockerTop,
  parseEtime,
  parsePs,
  redactCommand,
  runsOf,
  trackRun,
} from "./processes";

describe("redactCommand", () => {
  test("masks secrets in env assignments, flags, headers, keys and URLs", () => {
    expect(redactCommand("GITHUB_TOKEN=ghp_abcdefgh12345678 npm test")).toBe(
      "GITHUB_TOKEN=[redacted] npm test",
    );
    expect(redactCommand("curl --token abc123 https://example.invalid")).toBe(
      "curl --token [redacted] https://example.invalid",
    );
    expect(redactCommand('curl -H "Authorization: Bearer abc.def" https://example.invalid')).toBe(
      'curl -H "Authorization: [redacted]" https://example.invalid',
    );
    expect(redactCommand('API_KEY="a b c" run')).toBe("API_KEY=[redacted] run");
    expect(redactCommand("tool sk-test-abcdefghijkl")).toBe("tool [redacted]");
    expect(redactCommand("git clone https://user:pw@example.invalid/repo.git")).toBe(
      "git clone https://[redacted]@example.invalid/repo.git",
    );
  });
  test("keeps an ordinary command and cuts a long one", () => {
    expect(redactCommand("bun test src/a.test.ts")).toBe("bun test src/a.test.ts");
    expect(redactCommand("x".repeat(500))).toHaveLength(200);
  });
});

describe("parseEtime", () => {
  test("reads ps elapsed times", () => {
    expect(parseEtime("00:07")).toBe(7);
    expect(parseEtime("11:02")).toBe(662);
    expect(parseEtime("01:02:03")).toBe(3723);
    expect(parseEtime("2-00:00:00")).toBe(172800);
    expect(parseEtime("nonsense")).toBeUndefined();
  });
});

describe("process tree", () => {
  const ps = `  100     1    10:00 claude -p very long prompt
  101   100    09:59 node mcp-server.js
  102   100    00:42 bash -c sleep 900
  103   102    00:41 sleep 900
  200     1    05:00 unrelated`;
  test("parsePs reads pid, parent, elapsed time and command", () => {
    expect(parsePs(ps)[2]).toEqual({
      pid: 102,
      ppid: 100,
      runningFor: 42,
      command: "bash -c sleep 900",
    });
  });
  test("descendants lists what runs below the root, parents first, without the root or others", () => {
    expect(descendants(parsePs(ps), 100).map((r) => r.pid)).toEqual([101, 102, 103]);
  });
  test("parseDockerTop takes the command from the last column", () => {
    const top = `UID PID PPID C STIME TTY TIME CMD
1000 4001 3990 0 10:00 ? 00:00:01 claude -p hi
1000 4010 4001 0 10:01 ? 00:00:00 sleep 900`;
    expect(parseDockerTop(top)).toEqual([
      { pid: 4001, ppid: 0, command: "claude -p hi" },
      { pid: 4010, ppid: 0, command: "sleep 900" },
    ]);
  });
});

describe("trackRun", () => {
  test("a run is found by the turn's signal until it is forgotten", () => {
    const signal = new AbortController().signal;
    const forget = trackRun(signal, { harness: "codex", pid: 1, startedAt: 0 });
    expect(runsOf(signal).map((r) => r.pid)).toEqual([1]);
    forget();
    expect(runsOf(signal)).toEqual([]);
  });
});

// It runs ps and pkill, which Windows does not have.
describe.skipIf(process.platform === "win32")("listProcesses", () => {
  test("shows the CLI by name and the command it runs, from the real process table", async () => {
    const child = Bun.spawn(["sh", "-c", "sleep 30 & wait"], { detached: true, stdout: "ignore" });
    try {
      await Bun.sleep(300);
      const list = await listProcesses({ harness: "codex", pid: child.pid, startedAt: Date.now() });
      expect(list[0]!.command).toBe("codex");
      expect(list.some((p) => p.command === "sleep 30")).toBe(true);
    } finally {
      child.kill();
      Bun.spawn(["pkill", "-f", "sleep 30"]);
    }
  });
});

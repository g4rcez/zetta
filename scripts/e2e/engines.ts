// Asks every engine CLI installed on this machine to reply with one word, through the same code path a bot turn uses.
// Real calls: each costs a few tokens on the account that CLI is signed in to. An engine that is not installed or not signed in is
// recorded as such, never as a pass.
//   bun scripts/e2e/engines.ts [engine ...]
import {
  harnessCommands,
  runCli,
  type NativeHarness,
} from "../../apps/server/src/modules/chat/harness";
import { createReport } from "./report";

const ALL: NativeHarness[] = [
  "claude-code",
  "codex",
  "opencode",
  "pi",
  "omp",
  "cursor",
  "hermes",
  "deepseek",
];
const wanted = process.argv.slice(2) as NativeHarness[];
const engines = wanted.length ? wanted : ALL;
const EXE: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
  omp: "omp",
  cursor: "cursor-agent",
  hermes: "hermes",
  deepseek: "dsh",
};

const report = createReport("engines", "Engines: one real turn each");
for (const engine of engines) {
  const exe = EXE[engine] ?? engine;
  if (!Bun.which(exe)) {
    report.skip(engine, `\`${exe}\` is not installed on this machine`);
    continue;
  }
  const started = Date.now();
  try {
    const text = await runCli({
      harness: engine,
      prompt: "Reply with exactly the single word OK and nothing else.",
      model: null,
      timeoutMs: 150_000,
      heartbeatMs: 150_000,
    });
    const ms = Date.now() - started;
    if (/\bOK\b/i.test(text))
      report.pass(engine, `answered in ${(ms / 1000).toFixed(1)} s: ${text.slice(0, 60)}`);
    else
      report.fail(
        engine,
        `answered, but not as asked (${(ms / 1000).toFixed(1)} s): ${text.slice(0, 120)}`,
      );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Zetta hides the CLI's own error text. Run the same command by hand: if the CLI fails there too, the machine's account or
    // installation is the problem (recorded as skipped, with the CLI's last lines); if it works by hand, Zetta's call is the bug.
    const argv = harnessCommands[engine](
      "Reply with exactly the single word OK and nothing else.",
      null,
    );
    const direct = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      cwd: process.env.TMPDIR ?? "/tmp",
    });
    const timer = setTimeout(() => direct.kill(), 120_000);
    const [out, err] = await Promise.all([
      new Response(direct.stdout).text(),
      new Response(direct.stderr).text(),
    ]);
    clearTimeout(timer);
    const code = await direct.exited;
    const tail = `${out}\n${err}`
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-3)
      .join(" / ")
      .slice(0, 240);
    if (code !== 0 || !/\bOK\b/i.test(out))
      report.skip(
        engine,
        `installed, but the CLI also fails when run by hand on this machine (${message}): ${tail}`,
      );
    else report.fail(engine, `the CLI works by hand but not through Zetta (${message})`);
  }
}
report.note(
  "An engine only counts as verified here when it answered a real turn through `runCli`. Isolation (Docker mode), tools and streaming are not covered by this script.",
);
process.exit(report.finish("each engine CLI installed and signed in"));

// Drives the installed Claude Code CLI with an open stdin (`--input-format stream-json`) and records what it does with a message
// written while it works: during a tool call, after an answer, and right before stdin closes. This is what "fluid chat" builds on
// (docs/decisions/fluid-chat.md): the harness only relies on what this script saw.
// Real calls: four short turns on a cheap model, on the account the CLI is signed in to.
//   bun scripts/e2e/claude-live-input.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { streamCli } from "../../apps/server/src/modules/chat/harness";
import { poke } from "../../apps/server/src/modules/chat/poke";
import { uuidv7 } from "../../packages/core/src/uuid";
import { createReport } from "./report";

type Seen = { at: number; ev: Record<string, unknown> };
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const parts = (ev: Record<string, unknown>) => {
  const content = obj(ev.message).content;
  return Array.isArray(content) ? content.map(obj) : [];
};
const isToolResult = (ev: Record<string, unknown>) =>
  ev.type === "user" && parts(ev).some((p) => p.type === "tool_result");
const isToolUse = (ev: Record<string, unknown>) =>
  ev.type === "assistant" && parts(ev).some((p) => p.type === "tool_use");
const userLine = (uuid: string, text: string) =>
  `${JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    uuid,
  })}\n`;

/** One CLI process with an open stdin: every stdout line is kept with the time it arrived. */
function start(args: string[], cwd: string) {
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      "--model",
      "haiku",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--replay-user-messages",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools=Bash",
      ...args,
    ],
    { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const began = Date.now();
  const seen: Seen[] = [];
  const plain: string[] = [];
  const waiters = new Set<() => void>();
  const done = (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      for (let at = buf.indexOf("\n"); at !== -1; at = buf.indexOf("\n")) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        try {
          seen.push({ at: Date.now() - began, ev: obj(JSON.parse(line)) });
        } catch {
          if (line.trim()) plain.push(line);
        }
        // A waiter removes itself from the set, so the loop runs on a copy.
        // oxlint-disable-next-line unicorn/no-useless-spread
        for (const w of [...waiters]) w();
      }
    }
    // A waiter removes itself from the set, so the loop runs on a copy.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const w of [...waiters]) w();
  })();
  const stderr = new Response(proc.stderr).text();
  return {
    proc,
    began,
    seen,
    plain,
    stderr,
    done,
    write: (line: string) => {
      proc.stdin.write(line);
      proc.stdin.flush();
    },
    /** Resolves with the first event at or after `from` that matches, or undefined when the process ends or time runs out. */
    async until(match: (ev: Record<string, unknown>) => boolean, from = 0, ms = 120_000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = seen.slice(from).find((s) => match(s.ev));
        if (hit) return hit;
        if (proc.exitCode !== null || Date.now() > deadline) return undefined;
        await new Promise<void>((r) => {
          const t = setTimeout(r, 500);
          const w = () => {
            clearTimeout(t);
            waiters.delete(w);
            r();
          };
          waiters.add(w);
        });
      }
    },
  };
}

const report = createReport("claude-live-input", "Claude Code: a message written while it works");
if (!Bun.which("claude")) {
  report.skip("claude", "`claude` is not installed on this machine");
  process.exit(report.finish("the Claude CLI, signed in"));
}
const version = (await new Response(Bun.spawn(["claude", "--version"]).stdout).text()).trim();
report.note(`CLI version: ${version}`);

const cwd = await mkdtemp(join(tmpdir(), "zetta-live-input-"));
const session = uuidv7();
const [first, during, after, last] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const run = start(
  [
    "--session-id",
    session,
    "--append-system-prompt",
    "Follow the user's instructions exactly. Keep every reply to a few words.",
    `--mcp-config=${JSON.stringify({ mcpServers: {} })}`,
  ],
  cwd,
);
const kill = setTimeout(() => run.proc.kill(), 300_000);
try {
  // 1. The prompt as the first stdin line, with a session id, a system prompt and an MCP config.
  run.write(
    userLine(
      first,
      "Run this exact shell command with the Bash tool: `sleep 12 && echo first-done`. When it ends, reply with the single word ALPHA.",
    ),
  );
  const tool = await run.until(isToolUse);
  if (!tool)
    throw new Error(
      `no tool call: ${(await run.stderr).slice(-300)} ${run.plain.join(" ").slice(-300)}`,
    );
  report.pass(
    "prompt on stdin starts a run",
    `first tool call after ${(tool.at / 1000).toFixed(1)} s`,
  );

  // 2 and 3. A message written while the command runs.
  await Bun.sleep(2000);
  const wroteDuring = Date.now();
  run.write(userLine(during, "One more thing: end that reply with the word BRAVO."));
  const wroteAt = run.seen.length;
  const result1 = await run.until((ev) => ev.type === "result");
  if (!result1) throw new Error("no first result");
  const toolDone = run.seen.find((s) => isToolResult(s.ev));
  const replay = run.seen.find((s) => s.ev.uuid === during);
  const firstReplay = run.seen.find((s) => s.ev.uuid === first);
  const text1 = String(result1.ev.result ?? "");
  if (replay)
    report.pass(
      "the late message is replayed with our uuid",
      `keys: ${Object.keys(replay.ev).join(", ")}; isReplay=${String(replay.ev.isReplay)}; printed ${
        toolDone && replay.at >= toolDone.at ? "after" : "before"
      } the tool result (tool result at ${toolDone ? (toolDone.at / 1000).toFixed(1) : "?"} s, replay at ${(replay.at / 1000).toFixed(1)} s)`,
    );
  else report.fail("the late message is replayed with our uuid", "no stdout line carried the uuid");
  report.note(
    `First message replay: ${firstReplay ? `at ${(firstReplay.at / 1000).toFixed(1)} s, isReplay=${String(firstReplay.ev.isReplay)}` : "none"}.`,
  );
  if (/first-done/.test(JSON.stringify(toolDone?.ev ?? {})))
    report.pass("the running command is not cut", "the command printed its last line");
  else
    report.fail("the running command is not cut", JSON.stringify(toolDone?.ev ?? {}).slice(0, 200));
  if (/ALPHA/.test(text1) && /BRAVO/.test(text1))
    report.pass("one answer covers both messages", `result 1: ${text1.slice(0, 80)}`);
  else {
    // The late message may have been answered in a turn of its own.
    const result1b = await run.until(
      (ev) => ev.type === "result",
      run.seen.indexOf(result1) + 1,
      60_000,
    );
    report.fail(
      "one answer covers both messages",
      `result 1: ${text1.slice(0, 80)}; next result: ${String(result1b?.ev.result ?? "none").slice(0, 80)}`,
    );
  }
  report.note(
    `Late message written ${((wroteDuring - run.began) / 1000).toFixed(1)} s into the run; events after the write: ${run.seen
      .slice(wroteAt)
      .map((s) => `${s.ev.type}${s.ev.subtype ? `/${String(s.ev.subtype)}` : ""}`)
      .join(" ")}`,
  );

  // 4. A message written after an answer: a new answer from the same process.
  const from2 = run.seen.length;
  run.write(userLine(after, "Now reply with the single word CHARLIE."));
  const result2 = await run.until((ev) => ev.type === "result", from2);
  if (result2 && /CHARLIE/.test(String(result2.ev.result)))
    report.pass(
      "a message after an answer gets a new answer in the same process",
      String(result2.ev.result).slice(0, 60),
    );
  else
    report.fail(
      "a message after an answer gets a new answer in the same process",
      String(result2?.ev.result ?? "no result"),
    );

  // 5. A message written right before stdin closes.
  const from3 = run.seen.length;
  run.write(userLine(last, "Finally reply with the single word DELTA."));
  run.proc.stdin.end();
  const result3 = await run.until((ev) => ev.type === "result", from3);
  const code = await Promise.race([run.proc.exited, Bun.sleep(60_000).then(() => "still running")]);
  if (result3 && /DELTA/.test(String(result3.ev.result)))
    report.pass(
      "a message written before stdin closes is still answered",
      `exit code ${String(code)}`,
    );
  else
    report.fail(
      "a message written before stdin closes is still answered",
      `result: ${String(result3?.ev.result ?? "none")}; exit code ${String(code)}`,
    );
  if (code === 0) report.pass("the process exits when stdin closes", "exit code 0");
  else report.fail("the process exits when stdin closes", `exit code ${String(code)}`);

  // 6 and 7. What the result lines count, and which line types a parser must expect.
  const results = run.seen.filter((s) => s.ev.type === "result");
  report.note(
    `Results: ${results
      .map((r, i) => {
        const u = obj(r.ev.usage);
        return `#${i + 1} subtype=${String(r.ev.subtype)} num_turns=${String(r.ev.num_turns)} input=${String(u.input_tokens)} cache_read=${String(u.cache_read_input_tokens)} output=${String(u.output_tokens)} cost=${String(r.ev.total_cost_usd)}`;
      })
      .join("; ")}`,
  );
  const kinds = new Map<string, number>();
  for (const s of run.seen) {
    const k = `${String(s.ev.type)}${s.ev.subtype ? `/${String(s.ev.subtype)}` : ""}${s.ev.isReplay ? " (replay)" : ""}`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  report.note(`Line types on stdout: ${[...kinds].map(([k, n]) => `${k} x${n}`).join(", ")}`);
  if (run.plain.length)
    report.note(`Lines that are not JSON: ${run.plain.length} (${run.plain[0]!.slice(0, 80)})`);
  await run.done;

  // 8. The same session continued by a second process, again with the prompt on stdin.
  const again = start(["--resume", session], cwd);
  const kill2 = setTimeout(() => again.proc.kill(), 120_000);
  again.write(
    userLine(uuidv7(), "Which single words did I ask you to reply with so far? List them."),
  );
  again.proc.stdin.end();
  const resumed = await again.until((ev) => ev.type === "result");
  clearTimeout(kill2);
  const said = String(resumed?.ev.result ?? "");
  if (/ALPHA/.test(said) && /CHARLIE/.test(said))
    report.pass("--resume works with the prompt on stdin", said.slice(0, 80));
  else
    report.fail(
      "--resume works with the prompt on stdin",
      said.slice(0, 120) || (await again.stderr).slice(-200),
    );
  await again.proc.exited;
} catch (e) {
  report.fail("run", e instanceof Error ? e.message : String(e));
} finally {
  clearTimeout(kill);
  run.proc.kill();
  await rm(cwd, { recursive: true, force: true });
}
// 9. The same through Zetta's own runner: the code a bot turn uses, with a message handed over by a poke while a command runs.
{
  const abort = new AbortController();
  const waiting: { id: string; text: string }[] = [];
  const read: string[] = [];
  const note = uuidv7();
  let text = "";
  let poked = 0;
  const timer = setTimeout(() => abort.abort(), 180_000);
  try {
    for await (const chunk of streamCli({
      harness: "claude-code",
      model: "haiku",
      prompt:
        "Run this exact shell command with the Bash tool: `sleep 10 && echo zetta-done`. When it ends, reply with the single word ECHO.",
      system: "Follow the user's instructions exactly. Keep every reply to a few words.",
      signal: abort.signal,
      extraEnv: {},
      code: undefined,
      inbox: {
        take: async () => waiting.splice(0),
        read: (ids) => read.push(...ids),
      },
    })) {
      if (typeof chunk === "string") text += chunk;
      else if (!poked++) {
        // The first step is the command: the person writes two seconds into it.
        setTimeout(() => {
          waiting.push({ id: note, text: "One more thing: end that reply with the word FOXTROT." });
          poke(abort.signal);
        }, 2000);
      }
    }
    if (/ECHO/.test(text) && /FOXTROT/.test(text) && read.includes(note))
      report.pass(
        "Zetta's runner hands a message to a working run",
        `reply: ${text.slice(0, 80)}; read receipt received`,
      );
    else
      report.fail(
        "Zetta's runner hands a message to a working run",
        `reply: ${text.slice(0, 120)}; read: ${read.length ? "yes" : "no"}`,
      );
  } catch (e) {
    report.fail(
      "Zetta's runner hands a message to a working run",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    clearTimeout(timer);
  }
}
// 10. A separate quick question sent while the bot works is answered at once, and the work goes on.
{
  const abort = new AbortController();
  const waiting: { id: string; text: string }[] = [];
  const pieces: { at: number; text: string }[] = [];
  const steps: number[] = [];
  const began = Date.now();
  let poked = 0;
  const timer = setTimeout(() => abort.abort(), 240_000);
  try {
    for await (const chunk of streamCli({
      harness: "claude-code",
      model: "haiku",
      prompt:
        "Do these three steps one after another, each as its own Bash tool call: 1) `sleep 8 && echo one` 2) `sleep 8 && echo two` 3) `sleep 2 && echo three`. When all three are done, reply with the single word GOLF.",
      system: "Follow the user's instructions exactly. Keep every reply to a few words.",
      signal: abort.signal,
      inbox: { take: async () => waiting.splice(0), read: () => {} },
    })) {
      if (typeof chunk === "string") pieces.push({ at: Date.now() - began, text: chunk });
      else {
        steps.push(Date.now() - began);
        if (!poked++)
          setTimeout(() => {
            waiting.push({
              id: uuidv7(),
              text: "Separate quick question, unrelated to the task: what is the capital of France?",
            });
            poke(abort.signal);
          }, 2000);
      }
    }
    const quick = pieces.find((p) => /Paris/i.test(p.text));
    const last = pieces.at(-1);
    const stepsAfter = quick ? steps.filter((at) => at > quick.at).length : 0;
    if (quick && last && /GOLF/.test(last.text) && quick !== last && stepsAfter > 0)
      report.pass(
        "a quick question gets its answer while the work goes on",
        `answer at ${(quick.at / 1000).toFixed(1)} s, ${stepsAfter} step(s) after it, final reply at ${(last.at / 1000).toFixed(1)} s: ${pieces
          .map((p) => p.text.trim())
          .join(" / ")
          .slice(0, 100)}`,
      );
    else
      report.fail(
        "a quick question gets its answer while the work goes on",
        `pieces: ${pieces
          .map((p) => `${(p.at / 1000).toFixed(1)}s ${p.text.trim()}`)
          .join(" / ")
          .slice(0, 220)}; steps: ${steps.length}`,
      );
  } catch (e) {
    report.fail(
      "a quick question gets its answer while the work goes on",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    clearTimeout(timer);
  }
}
report.skip("the same under `docker run -i`", "not run: needs the bot image with a signed-in CLI");
process.exit(report.finish("the Claude CLI, signed in"));

// Does a "light" engine run (no host plugins, skills, MCP servers or tools) answer the daily lessons reading as well as a plain run, for
// fewer tokens? The same prompt goes through the real Claude CLI N times each way; what counts is the tokens and how much of the answer
// is the same. The default (`ZETTA_LIGHT_RUNS`) only changes when the light side wins on both (docs/decisions/lessons.md).
// Costs 2 x N small model calls on the account the Claude CLI is signed in to (N is 3 unless ZETTA_E2E_RUNS says otherwise).
//   bun scripts/e2e/light-run-compare.ts
import { runCli, type CliInput } from "../../apps/server/src/modules/chat/harness";
import { batchPrompt } from "../../apps/server/src/modules/learning/transcript";
import { parseCandidates } from "../../apps/server/src/modules/learning/validate";
import { jaccard, tokens } from "../../apps/server/src/modules/learning/text";
import { createReport } from "./report";

const report = createReport(
  "light-run-compare",
  "Light engine runs: the same lessons reading, with and without the host's plugins and tools",
);
if (!Bun.which("claude")) {
  report.skip("Claude CLI", "`claude` is not installed on this machine");
  process.exit(report.finish("the Claude CLI installed and signed in"));
}

const N = Math.max(1, Math.min(10, Number(process.env.ZETTA_E2E_RUNS ?? 3) || 3));
const transcript = [
  "[chat 1, 2026-11-17]",
  "person: A customer asks how long refunds take. What do I tell them?",
  "assistant: Refunds usually take five to seven business days after approval, depending on the bank, and some banks are slower around holidays.",
  "person: Too long. From now on, always answer refund questions in a single line.",
  "[chat 2, 2026-11-17]",
  "person: Summarise this month's tickets by category.",
  "assistant: Billing 41, login 28, shipping 19, other 12.",
  "person: Please put the monthly report in a table instead of a list.",
  "[chat 3, 2026-11-17]",
  "person: Now the quarterly numbers for the same categories.",
  "assistant: Q3: billing 120, login 80, shipping 61, other 33.",
  "person: Again as a table, like the monthly report. Reports go in tables.",
  "[chat 4, 2026-11-17]",
  "person: For this one e-mail only, sign it Marta.",
].join("\n");
const prompt = batchPrompt("Support helper", transcript, []);

type Side = { tokens: number[]; texts: Set<string>[]; failures: number };
async function side(light: boolean): Promise<Side> {
  // `light` is only honoured while this variable is on, so the plain side runs with it off.
  process.env.ZETTA_LIGHT_RUNS = light ? "on" : "off";
  const out: Side = { tokens: [], texts: [], failures: 0 };
  for (let i = 0; i < N; i++) {
    let total = 0;
    const input: CliInput = {
      harness: "claude-code",
      prompt,
      model: "haiku",
      timeoutMs: 240_000,
      onUsage: (u) => (total += u.input + u.cacheRead + u.cacheWrite + u.output),
      ...(light ? { light: "on" as const } : {}),
    };
    try {
      const answer = await runCli(input);
      const first = answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1);
      const parsed = parseCandidates(JSON.parse(first));
      out.texts.push(new Set(parsed.map((c) => tokens(c.text).join(" "))));
      out.tokens.push(total);
    } catch {
      out.failures++;
    }
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const plain = await side(false);
const light = await side(true);

await report.check("both sides answer every time", async () => {
  if (plain.failures || light.failures)
    throw new Error(`failed runs: plain ${plain.failures}, light ${light.failures} of ${N}`);
  return `${N} runs each`;
});
await report.check("the light side uses fewer tokens", async () => {
  const p = mean(plain.tokens);
  const l = mean(light.tokens);
  if (!p || !l) throw new Error("no token counts were reported");
  if (l >= p) throw new Error(`light ${Math.round(l)} is not below plain ${Math.round(p)}`);
  return `plain ${Math.round(p)} tokens, light ${Math.round(l)} (${Math.round((1 - l / p) * 100)}% fewer)`;
});
await report.check("the candidates are mostly the same (at least 80% overlap)", async () => {
  const all = (s: Side) => new Set(s.texts.flatMap((t) => [...t]));
  const a = [...all(plain)];
  const b = [...all(light)];
  if (!a.length || !b.length) throw new Error("one side proposed nothing");
  // Each candidate of one side counts as matched when the other side has a close one (60% of the words in common).
  const matched = (xs: string[], ys: string[]) =>
    xs.filter((x) => ys.some((y) => jaccard(x, y) >= 0.6)).length / xs.length;
  const overlap = Math.min(matched(a, b), matched(b, a));
  if (overlap < 0.8) throw new Error(`overlap is ${Math.round(overlap * 100)}%`);
  return `${Math.round(overlap * 100)}% of the candidates match`;
});
report.note(
  "Switch the default of ZETTA_LIGHT_RUNS to on only when every check here is green on this machine and on a second one.",
);
process.exit(report.finish("the Claude CLI installed and signed in"));

// Shared by every script in scripts/e2e: collects checks and writes .e2e-reports/<area>.md.
// A script that cannot run on this machine (no engine, no network, no image) calls `skip` so the report says so; nothing is faked.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dir, "../..");
const OUT = join(REPO, ".e2e-reports");

export type Check = { name: string; result: "pass" | "fail" | "skip"; detail?: string };

/** Reports get pasted into issues of a public repository: no absolute path, no home folder, no e-mail address. */
export const clean = (text: string) =>
  text
    .replaceAll(REPO, "<repo>")
    .replaceAll(homedir(), "~")
    .replace(/[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\/(?:private\/)?(?:var|tmp)\/[^\s"')]+/g, "<tmp>");

export function createReport(area: string, title: string) {
  const checks: Check[] = [];
  const notes: string[] = [];
  const started = new Date();
  const add = (c: Check) => {
    checks.push(c);
    console.log(
      `${c.result.toUpperCase().padEnd(4)} ${c.name}${c.detail ? `: ${clean(c.detail).slice(0, 200)}` : ""}`,
    );
  };
  return {
    pass: (name: string, detail?: string) => add({ name, result: "pass", detail }),
    fail: (name: string, detail?: string) => add({ name, result: "fail", detail }),
    skip: (name: string, detail: string) => add({ name, result: "skip", detail }),
    /** Runs one check; an exception is a failure with its message. */
    async check(name: string, run: () => Promise<string | void>) {
      try {
        add({ name, result: "pass", detail: (await run()) || undefined });
      } catch (e) {
        add({ name, result: "fail", detail: e instanceof Error ? e.message : String(e) });
      }
    },
    note: (text: string) => notes.push(text),
    /** Writes the report and returns the exit code: 1 when something failed. */
    finish(needs: string) {
      const failed = checks.filter((c) => c.result === "fail").length;
      const passed = checks.filter((c) => c.result === "pass").length;
      const skipped = checks.filter((c) => c.result === "skip").length;
      const verdict = failed
        ? "FAILED"
        : passed && !skipped
          ? "GREEN"
          : passed
            ? "PARTIAL"
            : "NOT RUN";
      const lines = [
        `# ${title}`,
        "",
        `Run: ${started.toISOString().slice(0, 16).replace("T", " ")} UTC. Result: **${verdict}** (${passed} passed, ${failed} failed, ${skipped} skipped).`,
        `Script: \`scripts/e2e/${area}.ts\`. Needs: ${needs}.`,
        "",
        "| Check | Result | Detail |",
        "| --- | --- | --- |",
        ...checks.map(
          (c) =>
            `| ${c.name} | ${c.result} | ${clean(c.detail ?? "")
              .replaceAll("|", "\\|")
              .replaceAll("\n", " ")
              .slice(0, 300)} |`,
        ),
        "",
        ...(notes.length ? ["## Notes", "", ...notes.map((n) => `- ${clean(n)}`), ""] : []),
      ];
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${area}.md`), lines.join("\n"));
      console.log(`\n${verdict}: .e2e-reports/${area}.md`);
      return failed ? 1 : 0;
    },
  };
}

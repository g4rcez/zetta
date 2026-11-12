import { describe, expect, test } from "bun:test";

import { changelogMarkdown } from "../apps/landing/src/machine/changelog";
import { LOG_FORMAT, parseLog } from "./changelog";

const line = (sha: string, iso: string, subject: string) => [sha, iso, subject].join("\x1f");
const sha = (c: string) => c.repeat(40);

describe("parseLog", () => {
  test("keeps feat, fix and perf with their scope, and drops the rest", () => {
    const days = parseLog(
      [
        line(sha("a"), "2026-11-12T10:00:00Z", "feat(chat): polls"),
        line(sha("b"), "2026-11-12T09:00:00Z", "fix: a crash"),
        line(sha("c"), "2026-11-12T08:00:00Z", "perf(web): faster list"),
        line(sha("d"), "2026-11-12T07:00:00Z", "docs: words"),
        line(sha("e"), "2026-11-12T06:00:00Z", "test(chat): more"),
        line(sha("f"), "2026-11-12T05:00:00Z", "refactor(db): rename"),
        line(sha("1"), "2026-11-12T04:00:00Z", "wip"),
      ].join("\n"),
    );
    expect(days).toEqual([
      {
        day: "2026-11-12",
        entries: [
          { type: "feat", scope: "chat", subject: "polls", sha: "aaaaaaa" },
          { type: "fix", scope: "", subject: "a crash", sha: "bbbbbbb" },
          { type: "perf", scope: "web", subject: "faster list", sha: "ccccccc" },
        ],
      },
    ]);
  });

  test("groups by the UTC day, newest day first, newest change first within a day", () => {
    const days = parseLog(
      [
        line(sha("a"), "2026-11-12T01:00:00Z", "feat: third"),
        line(sha("b"), "2026-11-11T23:30:00-03:00", "feat: second"),
        line(sha("c"), "2026-11-11T22:00:00Z", "feat: first"),
        line(sha("d"), "2026-11-10T12:00:00Z", "fix: older"),
      ].join("\n"),
    );
    // 23:30 at -03:00 is 02:30 UTC on the 12th.
    expect(days.map((d) => d.day)).toEqual(["2026-11-12", "2026-11-11", "2026-11-10"]);
    expect(days[0]!.entries.map((e) => e.subject)).toEqual(["third", "second"]);
    expect(days[1]!.entries.map((e) => e.subject)).toEqual(["first"]);
  });

  test("a breaking mark does not hide the commit, and an empty scope reads as none", () => {
    const days = parseLog(line(sha("a"), "2026-11-12T10:00:00Z", "feat(api)!: new shape"));
    expect(days[0]!.entries[0]).toMatchObject({ type: "feat", scope: "api", subject: "new shape" });
  });

  test("ignores blank lines, short lines and bad dates", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseLog(`\n${line(sha("a"), "not a date", "feat: x")}\nfeat: no sha`)).toEqual([]);
  });

  test("the format has the three fields the parser reads", () => {
    expect(LOG_FORMAT.split("\x1f")).toEqual(["%H", "%cI", "%s"]);
  });
});

describe("changelogMarkdown", () => {
  test("a heading per day and a line per change, with a link to the commit", () => {
    const md = changelogMarkdown([
      {
        day: "2026-11-12",
        entries: [{ type: "feat", scope: "chat", subject: "polls", sha: "abc1234" }],
      },
      {
        day: "2026-11-11",
        entries: [{ type: "fix", scope: "", subject: "a crash", sha: "def5678" }],
      },
    ]);
    expect(md).toContain("## 2026-11-12");
    expect(md).toContain(
      "- **New** (chat): polls ([abc1234](https://github.com/g4rcez/zetta/commit/abc1234))",
    );
    expect(md).toContain("- **Fixed**: a crash");
    expect(md.indexOf("2026-11-12")).toBeLessThan(md.indexOf("2026-11-11"));
  });
});

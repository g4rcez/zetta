import { describe, expect, it } from "bun:test";
import { compareToFeed, dayOf, MAX_UPDATE_CHANGES, parseFeed } from "./update-check";

const day = (d: string, n = 1) => ({
  day: d,
  entries: Array.from({ length: n }, (_, i) => ({
    type: "feat",
    scope: "chat",
    subject: `change ${d} ${i}`,
    sha: "abc1234",
  })),
});

describe("parseFeed", () => {
  it("reads the days of the landing changelog into flat changes", () => {
    const feed = parseFeed([day("2026-11-12", 2), day("2026-11-11")]);
    expect(feed?.map((c) => c.day)).toEqual(["2026-11-12", "2026-11-12", "2026-11-11"]);
    expect(feed?.[0]).toEqual({
      day: "2026-11-12",
      type: "feat",
      scope: "chat",
      subject: "change 2026-11-12 0",
      sha: "abc1234",
    });
  });
  it("is null when the answer is not a list", () => {
    expect(parseFeed({ days: [] })).toBeNull();
    expect(parseFeed("nope")).toBeNull();
  });
  it("drops what does not fit and cuts long text", () => {
    const feed = parseFeed([
      { day: "yesterday", entries: [] },
      {
        day: "2026-11-12",
        entries: [{ type: "chore", subject: "x" }, null, { type: "fix", subject: "" }],
      },
      {
        day: "2026-11-10",
        entries: [{ type: "fix", scope: "s", subject: "y".repeat(500), sha: "zz12ab" }],
      },
    ]);
    expect(feed).toHaveLength(1);
    expect(feed![0]!.subject).toHaveLength(200);
    expect(feed![0]!.sha).toBe("12ab");
  });
});

describe("compareToFeed", () => {
  const feed = parseFeed([day("2026-11-12"), day("2026-11-11"), day("2026-11-10")]);
  it("is behind when the feed has a day after the build's day, and lists those changes newest first", () => {
    const v = compareToFeed({ date: "2026-11-10T12:00:00Z" }, feed);
    expect(v.state).toBe("behind");
    expect(v.latest).toEqual({ date: "2026-11-12" });
    expect(v.changes.map((c) => c.day)).toEqual(["2026-11-12", "2026-11-11"]);
  });
  it("is current when the build is on the newest day", () => {
    const v = compareToFeed({ date: "2026-11-12T00:00:00Z" }, feed);
    expect(v).toEqual({ state: "current", latest: { date: "2026-11-12" }, changes: [] });
  });
  it("is unknown without a build, with a build date that is not a date, and with an empty or missing feed", () => {
    expect(compareToFeed(null, feed).state).toBe("unknown");
    expect(compareToFeed({ date: "soon" }, feed).state).toBe("unknown");
    expect(compareToFeed({ date: "2026-11-10T00:00:00Z" }, []).state).toBe("unknown");
    expect(compareToFeed({ date: "2026-11-10T00:00:00Z" }, null).state).toBe("unknown");
  });
  it("keeps at most 30 changes", () => {
    const long = parseFeed([day("2026-11-12", 50)]);
    const v = compareToFeed({ date: "2026-01-01T00:00:00Z" }, long);
    expect(v.changes).toHaveLength(MAX_UPDATE_CHANGES);
  });
});

describe("dayOf", () => {
  it("is the UTC day of a commit date", () => {
    expect(dayOf("2026-11-16T21:37:03-03:00")).toBe("2026-11-17");
    expect(dayOf("nope")).toBeUndefined();
  });
});

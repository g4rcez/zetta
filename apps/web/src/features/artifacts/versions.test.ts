import { describe, expect, test } from "bun:test";
import type { Artifact } from "./artifacts-api";
import { groupVersions } from "./versions";

const art = (id: string, title: string, botId: string | null = "b1"): Artifact => ({
  id,
  title,
  botId,
  description: "",
  fileName: `${id}.html`,
  mimeType: "text/html",
  kind: "html",
  size: 1,
  conversationId: null,
  routineRunId: null,
  pinnedAt: null,
  createdAt: "2026-10-28T00:00:00.000Z",
});

describe("groupVersions", () => {
  test("the same bot and title (ignoring case and spaces) form one group, newest first", () => {
    const groups = groupVersions([
      art("3", "Daily report"),
      art("2", " daily REPORT "),
      art("1", "Daily report"),
    ]);
    expect(groups.map((g) => [g.head.id, g.older.map((o) => o.id)])).toEqual([["3", ["2", "1"]]]);
  });
  test("another bot or another title is a separate group, in list order", () => {
    const groups = groupVersions([
      art("4", "A"),
      art("3", "A", "b2"),
      art("2", "B"),
      art("1", "A"),
    ]);
    expect(groups.map((g) => [g.head.id, g.older.map((o) => o.id)])).toEqual([
      ["4", ["1"]],
      ["3", []],
      ["2", []],
    ]);
  });
});

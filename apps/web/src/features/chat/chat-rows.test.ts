import { describe, expect, test } from "bun:test";

import {
  dayLabel,
  groupMessages,
  liveRows,
  reuseRows,
  type Row,
  type ZettaUIMessage,
} from "./chat-rows";

const at = (iso: string) => ({ createdAt: iso });

describe("groupMessages", () => {
  const now = new Date("2026-10-26T12:00:00");
  test("continues the same author within five minutes", () => {
    const g = groupMessages(
      [
        { role: "user", ...at("2026-10-26T10:00:00") },
        { role: "user", ...at("2026-10-26T10:04:00") },
        { role: "user", ...at("2026-10-26T10:10:00") },
      ],
      undefined,
      now,
    );
    expect(g.map((x) => x.continued)).toEqual([false, true, false]);
  });
  test("a different bot breaks the group", () => {
    const g = groupMessages(
      [
        { role: "assistant", botId: "a", ...at("2026-10-26T10:00:00") },
        { role: "assistant", botId: "b", ...at("2026-10-26T10:00:30") },
      ],
      undefined,
      now,
    );
    expect(g[1]!.continued).toBe(false);
  });
  test("a new day adds a divider and breaks the group", () => {
    const g = groupMessages(
      [
        { role: "user", ...at("2026-10-25T23:59:00") },
        { role: "user", ...at("2026-10-26T00:01:00") },
      ],
      undefined,
      now,
    );
    expect(g.map((x) => x.day)).toEqual(["Yesterday", "Today"]);
    expect(g[1]!.continued).toBe(false);
  });
  test("labels older days by date", () =>
    expect(dayLabel(new Date("2026-10-20T10:00:00"), now)).toContain("20"));
});

describe("liveRows", () => {
  test("a streamed reply goes into the thread the server names, even when the main chat follows the turn", () => {
    const turn: ZettaUIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "data-speaker",
            id: "m9",
            data: { messageId: "m9", botId: "chief", botName: "Chief", parentMessageId: "q1" },
          },
          { type: "text", text: "On it" },
        ],
      },
    ];
    expect(
      liveRows(turn, undefined, "2026-10-26T10:00:00Z").map((r) => [r.id, r.parentMessageId]),
    ).toEqual([["m9", "q1"]]);
  });
  test("splits one streamed turn into a row per speaker and swaps in saved messages", () => {
    const turn: ZettaUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi @Scout" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "data-speaker",
            id: "m1",
            data: { messageId: "m1", botId: "chief", botName: "Chief" },
          },
          { type: "text", text: "Hello" },
          {
            type: "data-saved",
            data: {
              message: {
                id: "m1",
                seq: 2,
                role: "assistant",
                content: "Hello!",
                status: "complete",
                botId: "chief",
                createdAt: "2026-10-26T10:00:00Z",
              },
            },
          },
          {
            type: "data-speaker",
            id: "m2",
            data: { messageId: "m2", botId: "scout", botName: "Scout" },
          },
          { type: "text", text: "On it" },
        ],
      },
    ];
    const rows = liveRows(turn);
    expect(rows.map((r) => [r.id, r.content, !!r.streaming])).toEqual([
      ["u1", "hi @Scout", false],
      ["m1", "Hello!", false],
      ["m2", "On it", true],
    ]);
    expect(rows[2]!.botName).toBe("Scout");
  });
  test("an activity part labels the row it names", () => {
    const turn: ZettaUIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "data-speaker",
            id: "m1",
            data: { messageId: "m1", botId: "chief", botName: "Chief" },
          },
          { type: "text", text: "Checking" },
          {
            type: "data-activity",
            data: { messageId: "m1", label: "plugin postgres.db_overview", at: 1000 },
          },
        ],
      },
    ];
    expect(liveRows(turn)[0]!.activity).toBe("plugin postgres.db_overview");
  });
  test("activity parts pile up as a timeline without repeats or generic thinking", () => {
    const activity = (label: string, at: number) =>
      ({ type: "data-activity", data: { messageId: "m1", label, at } }) as const;
    const turn: ZettaUIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "data-speaker", id: "m1", data: { messageId: "m1", botName: "Chief" } },
          activity("Thinking", 1000),
          activity("web_search", 2000),
          activity("web_search", 3000),
          activity("Thinking", 4000),
          activity("write_file", 5000),
        ],
      },
    ];
    expect(liveRows(turn)[0]!.timeline).toEqual([
      { at: 2000, label: "web_search" },
      { at: 5000, label: "write_file" },
    ]);
  });
});

describe("reuseRows", () => {
  const row = (id: string, content: string, extra: Partial<Row> = {}): Row => ({
    id,
    seq: 1,
    role: "assistant",
    content,
    status: "running",
    createdAt: "2026-10-26T10:00:00.000Z",
    parentMessageId: null,
    ...extra,
  });
  test("keeps the previous object for an unchanged row and takes the new one when it changed", () => {
    const prev = [row("a", "hello", { computers: [{ id: "vm", name: "Desk" }] }), row("b", "wor")];
    const next = [
      row("a", "hello", { computers: [{ id: "vm", name: "Desk" }] }),
      row("b", "world"),
    ];
    const out = reuseRows(prev, next);
    expect(out[0]).toBe(prev[0]!);
    expect(out[1]).toBe(next[1]!);
  });
  test("a changed nested list counts as a change", () => {
    const prev = [row("a", "x", { computers: [{ id: "vm", name: "Desk" }] })];
    const next = [row("a", "x", { computers: [{ id: "vm", name: "Laptop" }] })];
    expect(reuseRows(prev, next)[0]).toBe(next[0]!);
  });
});

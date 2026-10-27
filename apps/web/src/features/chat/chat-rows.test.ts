import { describe, expect, test } from "bun:test";

import { dayLabel, groupMessages, liveRows, type ZettaUIMessage } from "./chat-rows";

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
            id: "m1:activity",
            data: { messageId: "m1", label: "plugin postgres.db_overview" },
          },
        ],
      },
    ];
    expect(liveRows(turn)[0]!.activity).toBe("plugin postgres.db_overview");
  });
});

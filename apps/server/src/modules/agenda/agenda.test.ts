import { describe, expect, test } from "bun:test";
import { parseTools } from "../chat/tools";
import { fromGoogle, toGoogle } from "./google-sync";

describe("Google event mapping", () => {
  const base = { title: "Dentist", description: "", location: "", timezone: "America/Sao_Paulo" };
  test("timed items keep their time zone; an item without an end gets a 30 minute slot", () => {
    const g = toGoogle({ ...base, startAt: new Date("2026-10-27T12:00:00Z"), endAt: null, allDay: false });
    expect(g.start).toEqual({ dateTime: "2026-10-27T12:00:00.000Z", timeZone: "America/Sao_Paulo" });
    expect(g.end).toEqual({ dateTime: "2026-10-27T12:30:00.000Z", timeZone: "America/Sao_Paulo" });
    expect(g.description).toBeUndefined();
  });
  test("all-day items use dates with an exclusive end, and come back on the same calendar date", () => {
    const g = toGoogle({ ...base, startAt: new Date("2026-10-27T00:00:00Z"), endAt: null, allDay: true });
    expect(g).toMatchObject({ start: { date: "2026-10-27" }, end: { date: "2026-10-28" } });
    const back = fromGoogle({ id: "e1", start: { date: "2026-10-27" }, end: { date: "2026-10-28" }, summary: "Holiday" })!;
    expect(back.allDay).toBe(true); expect(back.startAt.toISOString()).toBe("2026-10-27T00:00:00.000Z");
  });
  test("events without a usable start are skipped; missing titles get a placeholder", () => {
    expect(fromGoogle({ id: "x" })).toBeUndefined();
    expect(fromGoogle({ id: "y", start: { dateTime: "2026-10-27T09:00:00-03:00" } })!.title).toBe("(no title)");
  });
});

describe("zetta:agenda blocks", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  test("add defaults to a task; list, complete and remove parse; bad dates and unknown actions are dropped", () => {
    const r = parseTools([
      '```zetta:agenda\n{"action":"add","title":"Call Ana","start":"2026-10-27T09:00:00-03:00"}\n```',
      '```zetta:agenda\n{"action":"list"}\n```',
      `\`\`\`zetta:agenda\n{"action":"complete","id":"${id}"}\n\`\`\``,
      '```zetta:agenda\n{"action":"add","title":"x","start":"tomorrow"}\n```',
      '```zetta:agenda\n{"action":"purge"}\n```',
      `\`\`\`zetta:agenda\n{"action":"remove","id":"../${id}"}\n\`\`\``,
    ].join("\n"));
    expect(r.calls).toEqual([
      { kind: "agenda", args: { action: "add", kind: "task", title: "Call Ana", start: "2026-10-27T09:00:00-03:00" } },
      { kind: "agenda", args: { action: "list" } },
      { kind: "agenda", args: { action: "complete", id } },
    ]);
    expect(r.text).toBe("");
  });
});

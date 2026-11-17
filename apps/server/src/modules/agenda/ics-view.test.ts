import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import type { ActiveActor } from "../identity/access";
import { configureIcsForTests } from "../integrations/plugins/ics";
import type { PluginContext } from "../integrations/plugins/registry";
import { createIcsAgendaView } from "./ics-view";
import { createAgendaRoutes } from "./routes";
import { createAgendaScheduler } from "./scheduler";

const ADDRESS = "https://calendar.example.invalid/private-feed-9/basic.ics";
const FEED = [
  "BEGIN:VCALENDAR",
  "X-WR-CALNAME:Feed name",
  "BEGIN:VEVENT",
  "UID:one@example.invalid",
  "SUMMARY:Standup",
  "DTSTART:20261201T090000Z",
  "DTEND:20261201T091500Z",
  "LOCATION:Room 1",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:two@example.invalid",
  "SUMMARY:Holiday",
  "DTSTART;VALUE=DATE:20261203",
  "RRULE:FREQ=DAILY;COUNT=2",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
const actor = { userId: "agenda-ics-user", isAdmin: false } as ActiveActor;
const range = { from: new Date("2026-12-01T00:00:00Z"), to: new Date("2026-12-10T00:00:00Z") };
const ctx = (config: Record<string, string>): PluginContext => ({
  userId: actor.userId,
  config,
  async setConfig() {},
});
let reply: () => Response;
beforeEach(() => {
  reply = () => new Response(FEED);
  configureIcsForTests({
    check: async () => {},
    fetch: async () => reply(),
  });
});
afterAll(() => configureIcsForTests({}));

describe("the calendar link in the Agenda", () => {
  test("no plugins or no installed link means nothing to show", async () => {
    expect(await createIcsAgendaView(undefined).external(actor, range.from, range.to)).toEqual([]);
    const missing = createIcsAgendaView({
      contextFor: async () => {
        throw new Error("not installed");
      },
    });
    expect(await missing.external(actor, range.from, range.to)).toEqual([]);
  });
  test("events come back shaped for the page, with the user's name for the calendar", async () => {
    const view = createIcsAgendaView({
      contextFor: async () => ctx({ url: ADDRESS, name: "Work" }),
    });
    const [feed] = await view.external(actor, range.from, range.to);
    expect(feed).toMatchObject({ source: "ics", calendar: "Work" });
    expect(feed!.error).toBeUndefined();
    expect(feed!.events.map((e) => [e.title, e.startAt, e.allDay, e.recurring])).toEqual([
      ["Standup", "2026-12-01T09:00:00.000Z", false, false],
      ["Holiday", "2026-12-03T00:00:00.000Z", true, true],
      ["Holiday", "2026-12-04T00:00:00.000Z", true, true],
    ]);
    expect(feed!.events[0]!.location).toBe("Room 1");
    // The two days of one recurring event get different, stable ids.
    const ids = feed!.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    const again = (await view.external(actor, range.from, range.to))[0]!.events.map((e) => e.id);
    expect(again).toEqual(ids);
  });
  test("the feed's own name is used when the user gave none", async () => {
    const view = createIcsAgendaView({ contextFor: async () => ctx({ url: ADDRESS }) });
    expect((await view.external(actor, range.from, range.to))[0]!.calendar).toBe("Feed name");
  });
  test("a feed that cannot be read says so in plain words and never shows the address", async () => {
    reply = () => new Response("", { status: 404 });
    const view = createIcsAgendaView({ contextFor: async () => ctx({ url: ADDRESS }) });
    const [feed] = await view.external(actor, range.from, range.to);
    expect(feed!.events).toEqual([]);
    expect(feed!.error).toContain("refused that address");
    expect(JSON.stringify(feed)).not.toContain("private-feed-9");
  });
});

describe("GET /api/agenda", () => {
  const app = () => {
    const scheduler = createAgendaScheduler(
      undefined as never,
      { contextFor: async () => ctx({ url: ADDRESS, name: "Work" }) },
      async () => ({ isAdmin: false }),
    );
    return new Elysia().use(
      createAgendaRoutes(
        {
          access: { requireActive: async () => actor } as never,
          agenda: { list: async () => [{ id: "own-item" }] } as never,
          scheduler,
        },
        ["http://web.test"],
      ),
    );
  };
  const get = async (query: string) =>
    (
      await app().handle(
        new Request(`http://localhost/api/agenda?${query}`, {
          headers: { origin: "http://web.test" },
        }),
      )
    ).json() as Promise<{ items: unknown[]; external: { calendar: string; events: unknown[] }[] }>;
  test("returns the user's own items and the link's events apart, so the page can mark them read-only", async () => {
    const out = await get("from=2026-12-01T00:00:00Z&to=2026-12-10T00:00:00Z");
    expect(out.items).toEqual([{ id: "own-item" }]);
    expect(out.external).toHaveLength(1);
    expect(out.external[0]!.calendar).toBe("Work");
    expect(out.external[0]!.events).toHaveLength(3);
  });
  test("a filter that leaves out events leaves the link out", async () => {
    const out = await get("from=2026-12-01T00:00:00Z&to=2026-12-10T00:00:00Z&kinds=task,note");
    expect(out.external).toEqual([]);
  });
});

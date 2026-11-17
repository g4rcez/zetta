import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { PluginError, PluginPause, type PluginAnswer, type PluginContext } from "../registry";
import { configureGoogleForTests } from "./oauth";
import { googlePlugin } from "./index";

/** The calendar tools against a fake Google: paths, bodies, the permission each call needs, and the cards of the writes. */
const NOW = 1_800_000_000_000;
type Seen = { url: URL; method: string; body: unknown };
let seen: Seen[] = [];
let reply: (s: Seen) => Response = () => Response.json({});
beforeEach(() => {
  seen = [];
  reply = () => Response.json({});
  configureGoogleForTests({
    calendarBase: "https://calendar.example.invalid/v3",
    now: () => NOW,
    fetch: async (input, init) => {
      const s: Seen = {
        url: new URL(String(input)),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      seen.push(s);
      return reply(s);
    },
  });
});
afterAll(() => configureGoogleForTests({}));

const account = (email: string, scopes: string) => ({
  email,
  refreshToken: `refresh-${email}`,
  accessToken: "access-test",
  expiresAt: String(NOW + 3_600_000),
  scopes,
});
const ctx = (
  scopes: string,
  more: ReturnType<typeof account>[] = [],
  secret = "secret-one",
): PluginContext => ({
  userId: "u-cal",
  config: {
    clientId: "cid",
    clientSecret: secret,
    accounts: JSON.stringify([account("me@example.invalid", scopes), ...more]),
  },
  async setConfig() {},
});
const tool = (n: string) => googlePlugin.tools!.find((t) => t.name === n)!;
const run = (n: string, a: Record<string, unknown>, c = ctx("calendar.events")) =>
  tool(n).handler(c, a);
const failure = async (p: Promise<unknown>) =>
  (await p.then(
    () => undefined,
    (e) => e,
  )) as unknown;
const accept = { action: "accept", content: {} } as const;
const resume = (c: PluginContext, id: string, answer: PluginAnswer = accept) =>
  googlePlugin.pausing!.resume(c, id, answer);
const writes = () => seen.filter((s) => s.method !== "GET");

const EVENT = {
  id: "ev1",
  summary: "Planning",
  start: { dateTime: "2026-03-01T10:00:00Z" },
  attendees: [{ email: "ana@example.invalid" }, { email: "bo@example.invalid" }],
};

describe("calendars and the permission they need", () => {
  test("calendar_list_calendars reads calendarList and frames the names as data", async () => {
    reply = () =>
      Response.json({
        items: [
          {
            id: "me@example.invalid",
            summary: "Me",
            primary: true,
            accessRole: "owner",
            timeZone: "UTC",
          },
          { id: "team@group.calendar.example.invalid", summary: "Team", accessRole: "reader" },
        ],
      });
    const out = (await run("calendar_list_calendars", {}, ctx("calendar.readonly"))) as string;
    expect(out).toContain("UNTRUSTED EXTERNAL CONTENT from Google Calendar");
    expect(out).toContain('"primary":true');
    expect(out).toContain("team@group.calendar.example.invalid");
    expect(seen[0]!.url.pathname).toBe("/v3/users/me/calendarList");
    expect(tool("calendar_list_calendars").effect).toBe("read");
  });
  test("an account without the calendar permission is asked to reconnect, with no call made", async () => {
    for (const name of ["calendar_list_calendars", "calendar_free_busy"]) {
      const e = (await failure(run(name, {}, ctx("calendar.events")))) as PluginError;
      expect(e.code).toBe("SCOPE_MISSING");
      expect(e.safe).toContain("Reconnect Google to allow this");
      expect(e.fix).toContain("Change permissions");
    }
    for (const [name, args] of [
      [
        "calendar_create_event",
        { title: "t", start: "2026-03-01T10:00:00Z", end: "2026-03-01T11:00:00Z" },
      ],
      ["calendar_update_event", { eventId: "ev1", title: "x" }],
      ["calendar_delete_event", { eventId: "ev1" }],
    ] as const) {
      const e = (await failure(run(name, args, ctx("calendar.events.readonly")))) as PluginError;
      expect(e.code).toBe("SCOPE_MISSING");
      expect(e.safe).toContain("Reconnect Google to allow this");
    }
    expect(seen).toHaveLength(0);
  });
  test("calendar.readonly alone can read events of another calendar", async () => {
    reply = () => Response.json({ items: [{ id: "e1", summary: "Standup" }] });
    const out = (await run(
      "calendar_list_events",
      { calendar: "team@group.calendar.example.invalid" },
      ctx("calendar.readonly"),
    )) as string;
    expect(out).toContain("Standup");
    expect(seen[0]!.url.pathname).toBe(
      `/v3/calendars/${encodeURIComponent("team@group.calendar.example.invalid")}/events`,
    );
  });
  test("list events defaults to the primary calendar and rejects an odd calendar id", async () => {
    await run("calendar_list_events", {}, ctx("calendar.events.readonly"));
    expect(seen[0]!.url.pathname).toBe("/v3/calendars/primary/events");
    expect(await failure(run("calendar_list_events", { calendar: "a/b" }))).toMatchObject({
      code: "INVALID_ARGS",
    });
  });
});

describe("calendar_free_busy", () => {
  test("asks freeBusy for each calendar and returns busy ranges", async () => {
    reply = () =>
      Response.json({
        calendars: {
          primary: { busy: [{ start: "2026-03-01T10:00:00Z", end: "2026-03-01T11:00:00Z" }] },
          "other@example.invalid": { errors: [{ reason: "notFound" }] },
        },
      });
    const out = (await run(
      "calendar_free_busy",
      {
        from: "2026-03-01T00:00:00Z",
        to: "2026-03-02T00:00:00Z",
        calendars: ["primary", "other@example.invalid"],
      },
      ctx("calendar.readonly"),
    )) as { calendars: Record<string, { busy?: unknown[]; error?: string }> };
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url.pathname).toBe("/v3/freeBusy");
    expect(seen[0]!.body).toEqual({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-02T00:00:00Z",
      items: [{ id: "primary" }, { id: "other@example.invalid" }],
    });
    expect(out.calendars.primary!.busy).toHaveLength(1);
    expect(out.calendars["other@example.invalid"]!.error).toContain("could not read");
    expect(tool("calendar_free_busy").effect).toBe("read");
  });
  test("defaults to primary and the next 7 days, and refuses bad ranges", async () => {
    await run("calendar_free_busy", {}, ctx("calendar.readonly"));
    const b = seen[0]!.body as { timeMin: string; timeMax: string; items: unknown[] };
    expect(b.items).toEqual([{ id: "primary" }]);
    expect(Date.parse(b.timeMax) - Date.parse(b.timeMin)).toBe(7 * 86_400_000);
    for (const args of [
      { from: "2026-03-02T00:00:00Z", to: "2026-03-01T00:00:00Z" },
      { from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" },
      { calendars: Array.from({ length: 21 }, (_, i) => `c${i}@example.invalid`) },
    ])
      expect(
        await failure(run("calendar_free_busy", args, ctx("calendar.readonly"))),
      ).toMatchObject({
        code: "INVALID_ARGS",
      });
    expect(seen).toHaveLength(1);
  });
});

describe("calendar_create_event", () => {
  const base = { title: "Lunch", start: "2026-03-01T12:00:00Z", end: "2026-03-01T13:00:00Z" };
  test("without guests it creates at once on the chosen calendar, e-mailing nobody", async () => {
    reply = () =>
      Response.json({ id: "new1", htmlLink: "https://calendar.example.invalid/e/new1" });
    const out = await run("calendar_create_event", { ...base, calendar: "team@example.invalid" });
    expect(out).toEqual({
      status: "created",
      eventId: "new1",
      link: "https://calendar.example.invalid/e/new1",
    });
    expect(seen[0]!.url.pathname).toBe(
      `/v3/calendars/${encodeURIComponent("team@example.invalid")}/events`,
    );
    expect(seen[0]!.url.searchParams.get("sendUpdates")).toBe("none");
    expect(seen[0]!.body).toMatchObject({ summary: "Lunch" });
    expect((seen[0]!.body as Record<string, unknown>).attendees).toBeUndefined();
  });
  test("with guests it stops on a card that lists them and says nobody is e-mailed", async () => {
    const e = (await failure(
      run("calendar_create_event", {
        ...base,
        attendees: ["Ana@Example.invalid", "ana@example.invalid", "bo@example.invalid"],
      }),
    )) as PluginPause;
    expect(e).toBeInstanceOf(PluginPause);
    expect(e.pause.tool).toBe("google.calendar_create_event");
    expect(e.pause.message).toContain("ana@example.invalid, bo@example.invalid");
    expect(e.pause.message).toContain("Nobody will be e-mailed");
    expect(seen).toHaveLength(0);
    reply = () => Response.json({ id: "new2" });
    const out = JSON.parse(await resume(ctx("calendar.events"), e.pause.requestId));
    expect(out.status).toBe("created");
    expect(writes()).toHaveLength(1);
    expect(seen[0]!.url.searchParams.get("sendUpdates")).toBe("none");
    expect((seen[0]!.body as { attendees: unknown }).attendees).toEqual([
      { email: "ana@example.invalid" },
      { email: "bo@example.invalid" },
    ]);
  });
  test("sendUpdates all is only sent after approval, and the card names who is e-mailed", async () => {
    const e = (await failure(
      run("calendar_create_event", {
        ...base,
        attendees: ["ana@example.invalid"],
        sendUpdates: "all",
      }),
    )) as PluginPause;
    expect(e.pause.message).toContain("Google will e-mail an invitation to ana@example.invalid");
    expect(seen).toHaveLength(0);
    await resume(ctx("calendar.events"), e.pause.requestId);
    expect(seen[0]!.url.searchParams.get("sendUpdates")).toBe("all");
  });
  test("sendUpdates all without guests sends nothing to anyone", async () => {
    await run("calendar_create_event", { ...base, sendUpdates: "all" });
    expect(seen[0]!.url.searchParams.get("sendUpdates")).toBe("none");
  });
  test("bad guests and bad values are refused before any call", async () => {
    for (const args of [
      { ...base, attendees: ["not-an-address"] },
      { ...base, attendees: ["a@b.invalid\r\nBcc: x@y.invalid"] },
      { ...base, attendees: Array.from({ length: 51 }, (_, i) => `g${i}@example.invalid`) },
      { ...base, sendUpdates: "externalOnly" },
      { ...base, end: base.start },
    ])
      expect(await failure(run("calendar_create_event", args))).toMatchObject({
        code: "INVALID_ARGS",
      });
    expect(seen).toHaveLength(0);
  });
});

describe("calendar_update_event", () => {
  test("stops on a card naming the event and the change, then patches exactly that", async () => {
    reply = (s) =>
      s.method === "GET"
        ? Response.json(EVENT)
        : Response.json({ id: "ev1", htmlLink: "https://calendar.example.invalid/e/ev1" });
    const e = (await failure(
      run("calendar_update_event", { eventId: "ev1", title: "Planning v2", location: "Room 4" }),
    )) as PluginPause;
    expect(e).toBeInstanceOf(PluginPause);
    expect(e.pause.mode).toBe("approval");
    expect(e.pause.message).toContain("Planning");
    expect(e.pause.message).toContain("title, location");
    expect(e.pause.message).toContain("Nobody will be e-mailed");
    expect(writes()).toHaveLength(0);
    expect(seen).toHaveLength(1); // only the read of the event
    const out = JSON.parse(await resume(ctx("calendar.events"), e.pause.requestId));
    expect(out).toMatchObject({ status: "updated", eventId: "ev1" });
    const patch = seen.at(-1)!;
    expect(patch.method).toBe("PATCH");
    expect(patch.url.pathname).toBe("/v3/calendars/primary/events/ev1");
    expect(patch.url.searchParams.get("sendUpdates")).toBe("none");
    expect(patch.body).toEqual({ summary: "Planning v2", location: "Room 4" });
  });
  test("with sendUpdates all the card lists the guests who will be e-mailed (the new list when given)", async () => {
    reply = () => Response.json(EVENT);
    const keep = (await failure(
      run("calendar_update_event", { eventId: "ev1", title: "X", sendUpdates: "all" }),
    )) as PluginPause;
    expect(keep.pause.message).toContain(
      "Google will e-mail the update to ana@example.invalid, bo@example.invalid",
    );
    const swap = (await failure(
      run("calendar_update_event", {
        eventId: "ev1",
        attendees: ["cy@example.invalid"],
        sendUpdates: "all",
      }),
    )) as PluginPause;
    expect(swap.pause.message).toContain("Google will e-mail the update to cy@example.invalid.");
    expect(swap.pause.message).not.toContain("bo@example.invalid");
    await resume(ctx("calendar.events"), swap.pause.requestId);
    const patch = seen.at(-1)!;
    expect(patch.url.searchParams.get("sendUpdates")).toBe("all");
    expect(patch.body).toEqual({ attendees: [{ email: "cy@example.invalid" }] });
  });
  test("declining changes nothing; asking for no change is refused", async () => {
    reply = () => Response.json(EVENT);
    const e = (await failure(
      run("calendar_update_event", { eventId: "ev1", title: "X" }),
    )) as PluginPause;
    const before = seen.length;
    expect(
      await resume(ctx("calendar.events"), e.pause.requestId, { action: "decline" }),
    ).toContain("declined");
    expect(seen).toHaveLength(before);
    expect(await failure(run("calendar_update_event", { eventId: "ev1" }))).toMatchObject({
      code: "INVALID_ARGS",
    });
    expect(
      await failure(run("calendar_update_event", { eventId: "../x", title: "t" })),
    ).toMatchObject({ code: "INVALID_ARGS" });
  });
});

describe("calendar_delete_event", () => {
  test("names the event on a card and deletes only after approval", async () => {
    reply = (s) =>
      s.method === "GET" ? Response.json(EVENT) : new Response(null, { status: 204 });
    const e = (await failure(
      run("calendar_delete_event", { eventId: "ev1", calendar: "team@example.invalid" }),
    )) as PluginPause;
    expect(e.pause.message).toContain("Delete the event “Planning”");
    expect(e.pause.message).toContain("team@example.invalid");
    expect(writes()).toHaveLength(0);
    const out = JSON.parse(await resume(ctx("calendar.events"), e.pause.requestId));
    expect(out).toEqual({ status: "deleted", eventId: "ev1" });
    const del = seen.at(-1)!;
    expect(del.method).toBe("DELETE");
    expect(del.url.searchParams.get("sendUpdates")).toBe("none");
  });
  test("sendUpdates all names the guests who get the cancellation", async () => {
    reply = () => Response.json(EVENT);
    const e = (await failure(
      run("calendar_delete_event", { eventId: "ev1", sendUpdates: "all" }),
    )) as PluginPause;
    expect(e.pause.message).toContain(
      "Google will e-mail the cancellation to ana@example.invalid, bo@example.invalid",
    );
  });
  test("an event Google cannot find is a plain not found", async () => {
    reply = () => new Response("{}", { status: 404 });
    expect(await failure(run("calendar_delete_event", { eventId: "gone" }))).toMatchObject({
      code: "NOT_FOUND",
    });
  });
  test("a 403 from Google never reaches the bot as raw text", async () => {
    reply = () => Response.json({ error: { message: "secret detail" } }, { status: 403 });
    const e = (await failure(run("calendar_delete_event", { eventId: "ev1" }))) as PluginError;
    expect(e.safe).not.toContain("secret detail");
  });
});

describe("approvals are bound to the call, the user and the account", () => {
  test("a forged id, another user's secret and an expired card change nothing", async () => {
    reply = () => Response.json(EVENT);
    const e = (await failure(run("calendar_delete_event", { eventId: "ev1" }))) as PluginPause;
    const before = seen.length;
    for (const id of ["p1.x.y", "nope", `${e.pause.requestId}x`])
      expect(await failure(resume(ctx("calendar.events"), id))).toMatchObject({ code: "EXPIRED" });
    expect(
      await failure(resume(ctx("calendar.events", [], "another-secret"), e.pause.requestId)),
    ).toMatchObject({ code: "EXPIRED" });
    configureGoogleForTests({
      calendarBase: "https://calendar.example.invalid/v3",
      now: () => NOW + 31 * 60_000,
      fetch: async () => Response.json({}),
    });
    const real = Date.now;
    Date.now = () => real() + 31 * 60_000;
    try {
      expect(await failure(resume(ctx("calendar.events"), e.pause.requestId))).toMatchObject({
        code: "EXPIRED",
      });
    } finally {
      Date.now = real;
    }
    expect(seen).toHaveLength(before);
  });
  test("an approval that names an approval of another tool kind is not run as a different call", async () => {
    reply = () => Response.json(EVENT);
    const e = (await failure(run("calendar_delete_event", { eventId: "ev1" }))) as PluginPause;
    reply = () => new Response(null, { status: 204 });
    await resume(ctx("calendar.events"), e.pause.requestId);
    expect(seen.at(-1)!.method).toBe("DELETE"); // the call that was shown is the call that ran
  });
});

describe("several accounts", () => {
  const second = account("work@example.invalid", "calendar.events");
  test("two accounts that can write need the account named; the card and the write use that account", async () => {
    const c = ctx("calendar.events", [second]);
    expect(await failure(run("calendar_delete_event", { eventId: "ev1" }, c))).toMatchObject({
      code: "ACCOUNT_REQUIRED",
    });
    reply = () => Response.json(EVENT);
    const e = (await failure(
      run("calendar_delete_event", { eventId: "ev1", account: "work@example.invalid" }, c),
    )) as PluginPause;
    expect(e.pause.message).toContain("work@example.invalid");
    reply = () => new Response(null, { status: 204 });
    await resume(c, e.pause.requestId);
    expect(seen.at(-1)!.method).toBe("DELETE");
  });
  test("an account that is not connected is named in the error", async () => {
    expect(
      await failure(run("calendar_list_events", { account: "nobody@example.invalid" })),
    ).toMatchObject({ code: "UNKNOWN_ACCOUNT" });
  });
});

describe("the plugin", () => {
  test("registers the new tools, and only writes lack the read mark", () => {
    const names = googlePlugin.tools!.map((t) => t.name);
    for (const n of [
      "calendar_list_calendars",
      "calendar_free_busy",
      "calendar_update_event",
      "calendar_delete_event",
    ])
      expect(names).toContain(n);
    for (const n of ["calendar_update_event", "calendar_delete_event", "calendar_create_event"])
      expect(tool(n).effect).not.toBe("read");
    expect(googlePlugin.pausing).toBeDefined();
  });
});

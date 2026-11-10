import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChief } from "../chat/chief";
import { createTurnRunner } from "../chat/pipeline";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createMemory } from "../memory/service";
import { createFeaturesService } from "./service";

// Real app, database and services. A routine's schedule can be sent as text ("when") instead of the fields.
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`when-a-${uuidv7()}`, `when-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const TZ = "America/Sao_Paulo";

suite("a routine's schedule written as text", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        getSession: async ({ headers }: { headers: Headers }) =>
          headers.get("x-test-user") ? { user: { id: headers.get("x-test-user")! } } : null,
      },
    } as never,
    async () => ({ isAdmin: false }),
  );
  const memory = createMemory(db);
  const run = createTurnRunner(
    db,
    (async () => "OK") as never,
    async function* () {
      yield "OK";
    } as never,
    memory,
  );
  const features = createFeaturesService(db, run);
  const chat = createChatService(
    db,
    run,
    undefined,
    undefined,
    undefined,
    undefined,
    { routine: features.routines.create as never, workflow: features.workflows.save as never },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { memory, routines: features.routines },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const row = async (id: string) =>
    (
      await db.$client.query(
        "select kind, daily_at, weekdays, every_minutes, once_at, timezone, paused, version from routine where id = $1",
        [id],
      )
    ).rows[0] as Record<string, any>;
  let botId: string;
  const routine = (over: Record<string, unknown>) => ({
    botId,
    title: "Digest",
    prompt: "Write the digest.",
    timezone: TZ,
    ...over,
  });

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    botId = (await call(A, "POST", "/api/bots", { name: "Digest bot" })).json.bot.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  test("Monday to Friday at 8:30 is created as those days at that time", async () => {
    const r = await call(A, "POST", "/api/routines", routine({ when: "Monday to Friday at 8:30" }));
    expect(r.status).toBe(201);
    expect(await row(r.json.routine.id)).toMatchObject({
      kind: "recurring",
      daily_at: "08:30",
      weekdays: [1, 2, 3, 4, 5],
      every_minutes: null,
      timezone: TZ,
      paused: true,
    });
  });

  test("a cron is accepted the same way", async () => {
    const r = await call(A, "POST", "/api/routines", routine({ when: "0 9 * * 1-5" }));
    expect(r.status).toBe(201);
    expect(await row(r.json.routine.id)).toMatchObject({
      daily_at: "09:00",
      weekdays: [1, 2, 3, 4, 5],
    });
  });

  test("every 15 minutes, and a one-time date", async () => {
    const every = await call(A, "POST", "/api/routines", routine({ when: "every 15 minutes" }));
    expect(await row(every.json.routine.id)).toMatchObject({
      kind: "recurring",
      every_minutes: 15,
      daily_at: null,
      weekdays: null,
    });
    const once = await call(A, "POST", "/api/routines", routine({ when: "in 3 hours" }));
    expect(once.status).toBe(201);
    const stored = await row(once.json.routine.id);
    expect(stored.kind).toBe("once");
    expect(stored.once_at.getTime()).toBeGreaterThan(Date.now() + 2.9 * 3_600_000);
    expect(stored.once_at.getTime()).toBeLessThan(Date.now() + 3.1 * 3_600_000);
  });

  test("text that cannot be read says what to write, and creates nothing", async () => {
    const before = (
      await db.$client.query("select count(*)::int as n from routine where owner_user_id = $1", [A])
    ).rows[0].n;
    for (const when of [
      "blah blah",
      "every Monday",
      "0 9 1 * *",
      "on the first of each month at 9am",
    ]) {
      const r = await call(A, "POST", "/api/routines", routine({ when }));
      expect(r.status, when).toBe(400);
      expect(r.json.error.code).toBe("SCHEDULE_TEXT");
      expect(r.json.error.message.length).toBeGreaterThan(20);
    }
    expect(
      (
        await db.$client.query("select count(*)::int as n from routine where owner_user_id = $1", [
          A,
        ])
      ).rows[0].n,
    ).toBe(before);
  });

  test("text and fields together are refused: they would be two answers", async () => {
    const r = await call(
      A,
      "POST",
      "/api/routines",
      routine({ when: "every day at 7am", dailyAt: "08:00" }),
    );
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("SCHEDULE_TEXT");
    expect(r.json.error.message).toMatch(/text or as fields/);
  });

  test("the fields still work as before", async () => {
    const r = await call(
      A,
      "POST",
      "/api/routines",
      routine({ dailyAt: "07:00", weekdays: [1, 3] }),
    );
    expect(r.status).toBe(201);
    expect(await row(r.json.routine.id)).toMatchObject({ daily_at: "07:00", weekdays: [1, 3] });
  });

  test("preview says what it understood, and shows runs on the right days at the right time", async () => {
    const r = await call(A, "POST", "/api/routines/preview", {
      timezone: TZ,
      when: "Monday to Friday at 8:30",
      count: 6,
    });
    expect(r.status).toBe(200);
    expect(r.json.understood).toBe(`weekdays at 08:30 (${TZ})`);
    expect(r.json.assumed).toBeNull();
    expect(r.json.nextRuns).toHaveLength(6);
    const local = (iso: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso));
    for (const iso of r.json.nextRuns) {
      expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(local(iso).slice(0, 3));
      expect(local(iso)).toContain("08:30");
    }
  });

  test("preview flags a time it had to assume", async () => {
    const r = await call(A, "POST", "/api/routines/preview", {
      timezone: TZ,
      when: "every weekday morning",
    });
    expect(r.status).toBe(200);
    expect(r.json.assumed).toMatch(/morning.*08:00/);
  });

  test("preview of text that cannot be read is a 400 with the reason", async () => {
    const r = await call(A, "POST", "/api/routines/preview", {
      timezone: TZ,
      when: "sometime soon",
    });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("SCHEDULE_TEXT");
  });

  describe("changing a routine's schedule with text", () => {
    let id: string;
    beforeAll(async () => {
      id = (await call(A, "POST", "/api/routines", routine({ when: "Monday to Friday at 8:30" })))
        .json.routine.id;
    });
    const patch = async (body: Record<string, unknown>) =>
      call(A, "PATCH", `/api/routines/${id}`, {
        expectedVersion: (await row(id)).version,
        ...body,
      });

    test("every day clears the weekday limit the routine had", async () => {
      const r = await patch({ timezone: TZ, when: "every day at 7am" });
      expect(r.status).toBe(200);
      expect(await row(id)).toMatchObject({ kind: "recurring", daily_at: "07:00", weekdays: null });
    });

    test("other days replace the old ones", async () => {
      await patch({ timezone: TZ, when: "Tuesdays and Thursdays at 14:15" });
      expect(await row(id)).toMatchObject({ daily_at: "14:15", weekdays: [2, 4] });
    });

    test("an interval drops the time and the days", async () => {
      await patch({ timezone: TZ, when: "every 30 minutes" });
      expect(await row(id)).toMatchObject({ every_minutes: 30, daily_at: null, weekdays: null });
    });

    test("a one-time date makes it one-time", async () => {
      await patch({ timezone: TZ, when: "tomorrow at 5pm" });
      const r = await row(id);
      expect(r).toMatchObject({
        kind: "once",
        daily_at: null,
        weekdays: null,
        every_minutes: null,
      });
      expect(r.once_at).toBeInstanceOf(Date);
    });

    test("the timezone must come with the text", async () => {
      const r = await patch({ when: "every day at 7am" });
      expect(r.status).toBe(400);
      expect(r.json.error.message).toMatch(/timezone/i);
    });

    test("text that cannot be read changes nothing", async () => {
      const before = await row(id);
      const r = await patch({ timezone: TZ, when: "blah" });
      expect(r.status).toBe(400);
      expect(await row(id)).toEqual(before);
    });
  });

  describe("through Chief", () => {
    const chief = createChief({ db, chat: chat as never, routines: features.routines });
    const actor = { userId: A } as never;
    const create = (over: Record<string, unknown>) =>
      chief.run(actor, {} as never, "routine", {
        action: "create",
        bot: "Digest bot",
        title: "Chief digest",
        prompt: "Write it.",
        timezone: TZ,
        activate: false,
        ...over,
      });

    test("a schedule in words becomes a card that shows it, and approving creates it", async () => {
      const out = await create({ when: "Monday to Friday at 8:30" });
      if (!("plan" in out)) throw new Error(`expected a plan, got ${JSON.stringify(out)}`);
      expect(out.plan.diff.find((d) => d.field === "schedule")!.to).toBe(
        `weekdays at 08:30 (${TZ})`,
      );
      expect(out.plan.diff.some((d) => d.field === "note")).toBe(false);
      await chief.apply(actor, out.plan.patch as never);
      const made = (
        await db.$client.query(
          "select daily_at, weekdays, paused from routine where owner_user_id = $1 and title = 'Chief digest' order by created_at desc limit 1",
          [A],
        )
      ).rows[0];
      expect(made).toMatchObject({ daily_at: "08:30", weekdays: [1, 2, 3, 4, 5], paused: true });
    });

    test("an assumed time is on the card, so the person sees it before approving", async () => {
      const out = await create({ when: "every weekday morning" });
      if (!("plan" in out)) throw new Error(`expected a plan, got ${JSON.stringify(out)}`);
      expect(out.plan.diff.find((d) => d.field === "note")!.to).toMatch(/morning.*08:00/);
    });

    test("text that cannot be read, or text and fields together, come back as a reason", async () => {
      expect(await create({ when: "blah blah" })).toMatchObject({
        error: expect.stringMatching(/Monday to Friday/),
      });
      expect(await create({ when: "every day at 7am", dailyAt: "08:00" })).toMatchObject({
        error: expect.stringMatching(/not both/),
      });
    });

    test("updating with words: every day clears the weekday limit", async () => {
      const id = (
        await call(
          A,
          "POST",
          "/api/routines",
          routine({ title: "Chief weekly", when: "Monday to Friday at 8:30" }),
        )
      ).json.routine.id;
      const out = await chief.run(actor, {} as never, "routine", {
        action: "update",
        routine: "Chief weekly",
        when: "every day at 7am",
      });
      if (!("plan" in out)) throw new Error(`expected a plan, got ${JSON.stringify(out)}`);
      const fields = out.plan.diff.map((d) => d.field);
      expect(fields).toEqual(expect.arrayContaining(["dailyAt", "days"]));
      await chief.apply(actor, out.plan.patch as never);
      expect(await row(id)).toMatchObject({ daily_at: "07:00", weekdays: null });
    });

    test("updating with the schedule it already has is said, not proposed", async () => {
      await call(
        A,
        "POST",
        "/api/routines",
        routine({ title: "Chief same", when: "every day at 9am" }),
      );
      const out = await chief.run(actor, {} as never, "routine", {
        action: "update",
        routine: "Chief same",
        when: "daily at 09:00",
      });
      expect(out).toMatchObject({ error: expect.stringMatching(/already has those settings/) });
    });
  });

  test("another person cannot change my routine with text", async () => {
    const mine = (await call(A, "POST", "/api/routines", routine({ when: "every day at 9am" })))
      .json.routine.id;
    const r = await call(B, "PATCH", `/api/routines/${mine}`, {
      expectedVersion: 1,
      timezone: TZ,
      when: "every day at 10am",
    });
    expect(r.status).not.toBe(200);
    expect((await row(mine)).daily_at).toBe("09:00");
  });
});

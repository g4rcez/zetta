import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../../app";
import { cleanupTestUsers } from "../../../test-support/db-cleanup";
import { createChief } from "../../chat/chief";
import type { CliInput } from "../../chat/harness";
import { createTurnRunner } from "../../chat/pipeline";
import { createChatService } from "../../chat/service";
import { createFeaturesService } from "../../features/service";
import { createIdentityAccess } from "../../identity/access";
import { createMemory } from "../../memory/service";
import { createSkills } from "../../skills/service";
import { createAnalyzer } from "./analyze";
import { presetFor } from "./avatar";
import { ImportError } from "./errors";
import { grokBotFixture } from "./fixtures";
import { parseGrokUrl, type GrokSource } from "./grok-source";
import { createBotImport } from "./service";

// Real app, database and services. Only the two outside boundaries are faked: the marketplace page and the engine that writes.
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`imp-a-${uuidv7()}`, `imp-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("importing a bot from the Grok Bot marketplace", () => {
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
  const library = createSkills(db);
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
    {
      memory,
      skills: { skills: library, market: undefined as never },
      routines: features.routines,
    },
  );

  const listing = grokBotFixture();
  const source: GrokSource = {
    list: async () => [
      {
        id: listing.id,
        name: listing.name,
        creatorName: listing.creatorName,
        handle: listing.handle,
        summary: listing.summary,
        categories: listing.categories,
        color: listing.color,
        shape: listing.shape,
        imageUrl: null,
        avatar: presetFor(listing),
      },
    ],
    get: async (idOrUrl) => {
      if (parseGrokUrl(idOrUrl) !== listing.id) throw new ImportError("NOT_FOUND", "no such bot");
      return listing;
    },
  };
  /** The engine: writes a playbook per skill asked for, and the persona. */
  let engineCalls = 0;
  const cli = async (input: CliInput) => {
    engineCalls++;
    if (input.prompt.startsWith("TASK: skills")) {
      const asked = [...input.prompt.matchAll(/"sourceId":"(skill-\d+)"/g)].map((m) => m[1]);
      return JSON.stringify({
        skills: asked.map((sourceId) => ({
          sourceId,
          description: `Use this for ${sourceId}.`,
          body: `# ${sourceId}\n\n1. Step one.\n2. Step two.`,
        })),
      });
    }
    return JSON.stringify({
      personality: "Brief and calm.",
      instructions: "Check the list each morning and report only what changed.",
      notes: listing.memories.map((m) => ({ sourceId: m.id, content: m.description })),
      routines: listing.routines.map((r) => ({
        sourceId: r.id,
        prompt: `Run the ${r.name} routine and report what changed.`,
      })),
    });
  };
  const analyzer = createAnalyzer({
    cli,
    chief: async () => ({ harness: "claude-code", model: null }),
    plugins: () => [{ id: "google", name: "Google" }],
    existingSkillNames: async (owner) =>
      new Set(
        (
          await db.$client.query(
            "select name from skill where owner_user_id = $1 and status = 'active'",
            [owner],
          )
        ).rows.map((r: { name: string }) => r.name),
      ),
    avatar: async () => ({ kind: "preset", preset: "circle", colors: ["#4a80e6"] }),
  });
  const botImport = createBotImport({
    db,
    chat: chat as never,
    skills: library,
    memory,
    routines: features.routines,
    source,
    analyzer,
  });
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
    botImport: { access, db, botImport },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });

  const call = async (
    as: string | null,
    method: string,
    path: string,
    body?: unknown,
    origin = "http://web.test",
  ) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(as ? { "x-test-user": as } : {}),
          origin,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const rows = async (sql: string, params: unknown[] = []) =>
    (await db.$client.query(sql, params)).rows as Record<string, any>[];

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
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  let draft: any;
  let botId: string;

  test("browsing and previewing need a signed-in person", async () => {
    expect((await call(null, "GET", "/api/bot-import/grok")).status).toBe(401);
    expect((await call(null, "POST", "/api/bot-import/install", { draft: {} })).status).toBe(401);
  });

  test("a request from another site is refused", async () => {
    const r = await call(
      A,
      "POST",
      "/api/bot-import/grok/analyze",
      { source: "example-bot", timezone: "America/Sao_Paulo" },
      "https://evil.example.invalid",
    );
    expect(r.status).toBe(403);
    expect(engineCalls).toBe(0);
  });

  test("the catalog lists the marketplace's bots", async () => {
    const r = await call(A, "GET", "/api/bot-import/grok");
    expect(r.status).toBe(200);
    expect(r.json.bots).toEqual([
      expect.objectContaining({
        id: "example-bot",
        name: "Example Bot",
        creatorName: "Example Creator",
      }),
    ]);
  });

  test("a preview shows the skills, routines in words, and which integrations Zetta has a plugin for", async () => {
    const r = await call(A, "GET", "/api/bot-import/grok/example-bot");
    expect(r.status).toBe(200);
    expect(r.json.bot.skills.map((s: any) => s.name)).toEqual(["Check the list", "Weekly summary"]);
    expect(r.json.bot.routines.map((x: any) => x.schedule)).toEqual([
      "weekdays at 08:44",
      "Mondays at 08:49",
    ]);
    expect(r.json.bot.integrations).toEqual([
      expect.objectContaining({ name: "Google Calendar", pluginId: "google" }),
      expect.objectContaining({ name: "Ramp", pluginId: null }),
    ]);
  });

  test("a link that is not a marketplace bot, and a bot that does not exist", async () => {
    expect((await call(A, "GET", "/api/bot-import/grok/Not%20A%20Slug")).json.error.code).toBe(
      "BAD_URL",
    );
    const missing = await call(A, "GET", "/api/bot-import/grok/nope");
    expect(missing.status).toBe(404);
    const bad = await call(A, "POST", "/api/bot-import/grok/analyze", {
      source: "https://evil.example.invalid/bot/marketplace/bots/example-bot",
      timezone: "UTC",
    });
    expect(bad.status).toBe(400);
    expect(engineCalls).toBe(0);
  });

  test("analyze writes a draft and creates nothing", async () => {
    const before = await rows("select count(*)::int as n from bot where owner_user_id = $1", [A]);
    const r = await call(A, "POST", "/api/bot-import/grok/analyze", {
      source: "https://x.ai/bot/marketplace/bots/example-bot",
      timezone: "America/Sao_Paulo",
    });
    expect(r.status).toBe(200);
    draft = r.json.draft;
    expect(draft).toMatchObject({
      name: "Example Bot",
      timezone: "America/Sao_Paulo",
      personality: "Brief and calm.",
    });
    expect(draft.skills.map((s: any) => s.name)).toEqual(["check-the-list", "weekly-summary"]);
    expect(draft.routines.map((x: any) => [x.schedule, x.state])).toEqual([
      [{ kind: "daily", dailyAt: "08:44", weekdays: [1, 2, 3, 4, 5] }, "active"],
      [{ kind: "daily", dailyAt: "08:49", weekdays: [1] }, "active"],
    ]);
    expect(await rows("select count(*)::int as n from bot where owner_user_id = $1", [A])).toEqual(
      before,
    );
    expect(
      await rows("select count(*)::int as n from skill where owner_user_id = $1", [A]),
    ).toEqual([{ n: 0 }]);
  });

  test("analyze with a timezone that does not exist is refused before the engine is asked", async () => {
    const calls = engineCalls;
    const r = await call(A, "POST", "/api/bot-import/grok/analyze", {
      source: "example-bot",
      timezone: "Mars/Olympus_Mons",
    });
    expect(r.status).toBe(400);
    expect(engineCalls).toBe(calls);
  });

  test("install creates the bot with its credit, skills, notes and running routines", async () => {
    const r = await call(A, "POST", "/api/bot-import/install", { draft });
    expect(r.status).toBe(201);
    botId = r.json.result.bot.id;
    expect(r.json.result.routines.map((x: any) => x.state)).toEqual(["active", "active"]);

    const [bot] = await rows(
      "select name, visibility, code_access, kind, origin, avatar from bot where id = $1",
      [botId],
    );
    expect(bot).toMatchObject({
      name: "Example Bot",
      visibility: "private",
      code_access: false,
      kind: "specialist",
    });
    expect(bot!.origin).toMatchObject({
      source: "grok_marketplace",
      url: "https://x.ai/bot/marketplace/bots/example-bot",
      creator: "Example Creator",
      integrations: [
        expect.objectContaining({ name: "Google Calendar", pluginId: "google" }),
        expect.objectContaining({ name: "Ramp", pluginId: null }),
      ],
    });
    expect(bot!.avatar).toMatchObject({ kind: "preset" });

    const skills = await rows(
      "select s.name, s.status, s.source, s.body from skill s join bot_skill bs on bs.skill_id = s.id where bs.bot_id = $1 order by s.name",
      [botId],
    );
    expect(skills.map((s) => s.name)).toEqual(["check-the-list", "weekly-summary"]);
    expect(skills.every((s) => s.status === "active" && s.source === "manual")).toBe(true);
    expect(skills[0]!.body).toContain("Step one");

    const notes = await rows(
      "select type, status, content, bot_access from memory_item where author_bot_id = $1 order by content",
      [botId],
    );
    expect(notes.map((n) => n.content)).toEqual([
      "Stay quiet when nothing changed.",
      "The list lives in the shared sheet called Things.",
    ]);
    expect(notes.every((n) => n.type === "solo" && n.status !== "archived")).toBe(true);

    const routines = await rows(
      "select title, paused, status, daily_at, weekdays, timezone, next_run_at from routine where bot_id = $1 order by title",
      [botId],
    );
    expect(
      routines.map((x) => [x.title, x.paused, x.status, x.daily_at, x.weekdays, x.timezone]),
    ).toEqual([
      ["morning-check", false, "scheduled", "08:44", [1, 2, 3, 4, 5], "America/Sao_Paulo"],
      ["weekly-summary", false, "scheduled", "08:49", [1], "America/Sao_Paulo"],
    ]);
    // The next run really falls on an allowed weekday in the routine's own timezone.
    const day = (d: Date, tz: string) =>
      new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
    expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(
      day(routines[0]!.next_run_at, "America/Sao_Paulo"),
    );
    expect(day(routines[1]!.next_run_at, "America/Sao_Paulo")).toBe("Mon");
  });

  test("the importer's own bot is private to the person", async () => {
    expect(
      (
        await rows(
          "select count(*)::int as n from bot where owner_user_id = $1 and origin is not null",
          [B],
        )
      )[0]!.n,
    ).toBe(0);
    const bBots = await call(B, "GET", "/api/bots");
    expect(JSON.stringify(bBots.json)).not.toContain(botId);
  });

  test("installing the same draft again is refused: the skill names are taken, and nothing new is made", async () => {
    const before = (
      await rows("select count(*)::int as n from bot where owner_user_id = $1", [A])
    )[0]!.n;
    const r = await call(A, "POST", "/api/bot-import/install", { draft });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("DUPLICATE");
    expect(
      (await rows("select count(*)::int as n from bot where owner_user_id = $1", [A]))[0]!.n,
    ).toBe(before);
  });

  test("another person can install the same bot: skill names are per person", async () => {
    const r = await call(B, "POST", "/api/bot-import/install", { draft });
    expect(r.status).toBe(201);
    expect(r.json.result.bot.id).not.toBe(botId);
  });

  test("a draft edited into something invalid is refused with a reason", async () => {
    const r = await call(A, "POST", "/api/bot-import/install", { draft: { ...draft, name: "" } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID_DRAFT");
    const extra = await call(A, "POST", "/api/bot-import/install", {
      draft: { ...draft, ownerUserId: B },
    });
    expect(extra.status).toBe(400);
  });

  test("when a skill is refused halfway, the bot and what was already made are undone", async () => {
    const bad = {
      ...draft,
      name: "Rollback Bot",
      skills: [
        { ...draft.skills[0], name: "rollback-one", sourceId: "x1" },
        // Passes the draft's checks, but the skill library refuses text that holds a password.
        {
          ...draft.skills[1],
          name: "rollback-two",
          sourceId: "x2",
          body: "Log in with password: hunter2hunter2 and go.",
        },
      ],
    };
    const r = await call(A, "POST", "/api/bot-import/install", { draft: bad });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID_DRAFT");
    expect(r.json.error.message).toContain("rollback-two");
    const [b] = await rows(
      "select archived from bot where owner_user_id = $1 and name = 'Rollback Bot'",
      [A],
    );
    expect(b).toEqual({ archived: true });
    expect(
      await rows(
        "select name from skill where owner_user_id = $1 and name like 'rollback-%' and status = 'active'",
        [A],
      ),
    ).toEqual([]);
    expect(
      await rows(
        "select 1 from routine r join bot b on b.id = r.bot_id where b.name = 'Rollback Bot' and r.archived = false",
      ),
    ).toEqual([]);
  });

  describe("through Chief", () => {
    const chief = createChief({
      db,
      chat: chat as never,
      skills: library,
      memory,
      routines: features.routines,
      botImport: { source, analyzer },
    });
    const actor = { userId: A } as never;

    test("a preview is a plain read", async () => {
      const out = await chief.run(actor, {} as never, "import_bot", {
        action: "preview",
        source: "example-bot",
      });
      expect(out).toMatchObject({ read: expect.stringContaining("Example Bot") });
    });

    test("an install is a plan that lists everything and creates nothing until approved", async () => {
      // Free the names the first install took, so the plan can be applied.
      await db.$client.query("update skill set status = 'archived' where owner_user_id = $1", [A]);
      const before = (
        await rows("select count(*)::int as n from bot where owner_user_id = $1", [A])
      )[0]!.n;
      const out = await chief.run(actor, {} as never, "import_bot", {
        action: "install",
        source: "https://x.ai/bot/marketplace/bots/example-bot",
        timezone: "America/Sao_Paulo",
      });
      if (!("plan" in out)) throw new Error(`expected a plan, got ${JSON.stringify(out)}`);
      const fields = out.plan.diff.map((d) => d.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          "bot",
          "instructions",
          "skill",
          "note",
          "routine",
          "needs setup",
          "note to you",
        ]),
      );
      expect(
        out.plan.diff.find((d) => d.field === "needs setup" && String(d.to).startsWith("Ramp"))!.to,
      ).toContain("no Zetta equivalent");
      expect(
        (await rows("select count(*)::int as n from bot where owner_user_id = $1", [A]))[0]!.n,
      ).toBe(before);

      const said = await chief.apply(actor, out.plan.patch as never);
      expect(said).toContain("Created Example Bot with 2 skills, 2 notes and 2 routines");
      expect(
        (await rows("select count(*)::int as n from bot where owner_user_id = $1", [A]))[0]!.n,
      ).toBe(before + 1);
    });

    test("an unreadable link is told to the chief as a reason, not thrown", async () => {
      const out = await chief.run(actor, {} as never, "import_bot", {
        action: "install",
        source: "https://evil.example.invalid/x",
        timezone: "UTC",
      });
      expect(out).toMatchObject({ error: expect.stringContaining("marketplace") });
    });

    test("a stored plan that was tampered with is refused when approved", async () => {
      await expect(
        chief.apply(actor, {
          tool: "import_bot",
          op: "install",
          draft: { ...draft, name: "" },
        } as never),
      ).rejects.toBeDefined();
    });
  });
});

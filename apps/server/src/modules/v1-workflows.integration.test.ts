import { uuidv7 } from "@zetta/core/uuid";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { team, teamMember } from "@zetta/db/schema/teams";
import { createApp } from "../app";
import { cleanupTestUsers } from "../test-support/db-cleanup";
import { createBotClaude } from "./bot-claude/store";
import { createChatService } from "./chat/service";
import { HarnessError } from "./chat/harness";
import { createTurnRunner } from "./chat/pipeline";
import { createWiki } from "./wiki/service";
import { createFeaturesService } from "./features/service";
import { createIdentityAccess } from "./identity/access";

/**
 * RFC-067: representative v1 journeys end to end through the HTTP API. The model is a scripted fake wired into the REAL turn
 * pipeline (hooks, memory, instruction retrieval, tools, proposals), so these prove Zetta's behaviour, not any vendor model.
 * Real-model evidence is separate (claude-code/haiku opt-in test and the browser walkthrough in docs/verification/v1-workflows.md).
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`v1-a-${uuidv7()}`];
const [A] = ids as [string];

suite("v1 user journeys", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const script: string[] = [];
  const prompts: string[] = [];
  /** The skill files installed for the latest run (Claude Code plugin dir). */
  let installed: Record<string, string> = {};
  type Run = { prompt: string; harness: string; profile?: { files: Record<string, string> } };
  const cli = async (t: Run) => {
    if (t.harness === "cursor") throw new HarnessError("not_installed");
    prompts.push(t.prompt);
    installed = t.profile?.files ?? {};
    return script.shift() ?? "OK";
  };
  const stream = async function* (t: Run) {
    if (t.harness === "cursor") throw new HarnessError("not_installed");
    prompts.push(t.prompt);
    installed = t.profile?.files ?? {};
    yield script.shift() ?? "OK";
  };
  const wiki = createWiki(db);
  const run = createTurnRunner(db, cli as never, stream as never, wiki);
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
    { wiki },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
    wiki: { access, wiki },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": A,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: A,
      name: A,
      email: `${A}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  test("a new bot is ready at once: its routine can be activated with no onboarding check", async () => {
    const bot = (
      await call("POST", "/api/bots", { name: "Newsie", harness: "pi", personality: "brief" })
    ).json.bot;
    expect(bot.onboarded).toBe(true);
    const r = (
      await call("POST", "/api/routines", {
        botId: bot.id,
        title: "Digest",
        prompt: "digest",
        timezone: "UTC",
        everyMinutes: 60,
      })
    ).json.routine;
    expect((await call("POST", `/api/routines/${r.id}/paused`, { paused: false })).status).toBe(
      200,
    );
  });

  test("a team item reaches only bots of that team, and a picked item is followed in full", async () => {
    const mk = async (name: string) => {
      const b = (await call("POST", "/api/bots", { name, harness: "pi" })).json.bot;
      await db.$client.query("update bot set onboarded = true where id = $1", [b.id]);
      return b;
    };
    const [inside, outside] = [await mk("Insider"), await mk("Outsider")];
    const [t] = await db
      .insert(team)
      .values({ ownerUserId: A, name: `Deployers-${uuidv7().slice(-6)}` })
      .returning();
    await db.insert(teamMember).values({ teamId: t!.id, botId: inside.id, kind: "chief" });
    const item = {
      title: "Release checklist",
      howto: "release",
      tags: ["instruction"],
      content: "1) tag the commit 2) push the tag",
      type: "teams",
      expectedVersion: 0,
    };
    // A team that is not the owner's cannot be used.
    expect(
      (await call("PUT", "/api/wiki/nope", { ...item, title: "Nope", teams: [uuidv7()] })).status,
    ).toBe(400);
    const made = await call("PUT", "/api/wiki/release-checklist", { ...item, teams: [t!.id] });
    expect(made.status).toBe(200);
    const id = (
      await db.$client.query(
        "select id from wiki_page where slug = 'release-checklist' and owner_user_id = $1",
        [A],
      )
    ).rows[0].id as string;
    const say = async (b: { id: string }, content: string, wikiIds?: string[]) => {
      const conv = (await call("POST", "/api/conversations", { botId: b.id })).json.conversation.id;
      prompts.length = 0;
      return call("POST", `/api/conversations/${conv}/messages`, {
        content,
        ...(wikiIds ? { wikiIds } : {}),
      });
    };
    await say(inside, "Prepare the release candidate today");
    expect(prompts.at(-1)).toContain("tag the commit");
    await say(outside, "Prepare the release candidate today");
    expect(prompts.at(-1)).not.toContain("Release checklist");
    // The person picks it: the bot follows it even though it is not in the team.
    const picked = await say(outside, "Go", [id]);
    expect(prompts.at(-1)).toContain("The user asked you to follow these memory items");
    expect(prompts.at(-1)).toContain("1) tag the commit 2) push the tag");
    expect(picked.json.assistant.meta.used.instructions).toEqual([{ id }]);
    expect((await say(outside, "Go", [uuidv7()])).status).toBe(404);
  });

  test("a skill picked with / is named in the prompt of the bot that has it; an unknown one is refused", async () => {
    const mk = async (name: string, harness: string) => {
      const b = (await call("POST", "/api/bots", { name, harness })).json.bot;
      await db.$client.query("update bot set onboarded = true where id = $1", [b.id]);
      return b;
    };
    const addSkill = (botId: string) =>
      createBotClaude(db).addAsset(botId, {
        kind: "skill",
        name: "release-notes",
        description: "Write release notes",
        body: "1) list the merged pull requests",
        tools: [],
        model: null,
        enabled: true,
      });
    const [claude, hermes, plain] = [
      await mk("SkillClaude", "claude-code"),
      await mk("SkillHermes", "hermes"),
      await mk("SkillPlain", "pi"),
    ];
    await addSkill(claude.id);
    await addSkill(hermes.id);

    // The picker lists the bot's own skills and Zetta's, with no instructions; a harness without skills lists none.
    expect((await call("GET", `/api/bots/${claude.id}/skills`)).json).toEqual({
      skills: [
        { name: "release-notes", description: "Write release notes", source: "bot" },
        expect.objectContaining({ name: "zetta-recover-from-failure" }),
        expect.objectContaining({ name: "zetta-long-running-work" }),
        expect.objectContaining({ name: "zetta-verify-before-done" }),
      ],
    });
    expect((await call("GET", `/api/bots/${plain.id}/skills`)).json).toEqual({ skills: [] });
    expect((await call("GET", `/api/bots/${uuidv7()}/skills`)).status).toBe(404);

    const say = async (b: { id: string }, skills: string[]) => {
      const conv = (await call("POST", "/api/conversations", { botId: b.id })).json.conversation.id;
      prompts.length = 0;
      return call("POST", `/api/conversations/${conv}/messages`, { content: "Go", skills });
    };
    expect((await say(claude, ["release-notes"])).status).toBe(201);
    expect(prompts.at(-1)).toContain(
      "Load each with the Skill tool before you answer: zetta-bot:release-notes.",
    );
    expect((await say(hermes, ["release-notes"])).status).toBe(201);
    expect(prompts.at(-1)).toContain(
      'follow these skills for this message (see "Skills you have" above): release-notes.',
    );
    // A built-in skill can be picked too.
    expect((await say(claude, ["zetta-verify-before-done"])).status).toBe(201);
    // A name the bot does not have, or a bot whose harness has no skills, is refused.
    expect((await say(claude, ["nope"])).status).toBe(404);
    expect((await say(plain, ["release-notes"])).status).toBe(404);
  });

  test("skills from the server user's home are offered to every harness, and the prompt says to use them without carrying their text", async () => {
    const home = await mkdtemp(join(tmpdir(), "zetta-v1-home-"));
    const put = async (dir: string, name: string, text: string) => {
      await mkdir(join(home, dir, name), { recursive: true });
      await writeFile(join(home, dir, name, "SKILL.md"), text);
    };
    await put(
      ".claude/skills",
      "host-native",
      "---\ndescription: In the Claude folder\n---\nnative steps",
    );
    await put(
      ".agents/skills",
      "host-shared",
      "---\ndescription: In the shared folder\n---\nshared steps",
    );
    const was = { home: process.env.HOME, on: process.env.ZETTA_HOST_SKILLS };
    const mk = async (name: string, harness: string) => {
      const b = (await call("POST", "/api/bots", { name, harness })).json.bot;
      await db.$client.query("update bot set onboarded = true where id = $1", [b.id]);
      return b;
    };
    const say = async (b: { id: string }, skills: string[]) => {
      const conv = (await call("POST", "/api/conversations", { botId: b.id })).json.conversation.id;
      prompts.length = 0;
      return call("POST", `/api/conversations/${conv}/messages`, { content: "Go", skills });
    };
    try {
      process.env.HOME = home;
      const [claude, plain] = [await mk("HostClaude", "claude-code"), await mk("HostPlain", "pi")];
      // Off by default: nothing is listed and a pick is refused.
      delete process.env.ZETTA_HOST_SKILLS;
      expect((await call("GET", `/api/bots/${plain.id}/skills`)).json).toEqual({ skills: [] });
      expect((await say(plain, ["host-native"])).status).toBe(404);

      process.env.ZETTA_HOST_SKILLS = "on";
      expect((await call("GET", `/api/bots/${plain.id}/skills`)).json).toEqual({
        skills: [
          { name: "host-native", description: "In the Claude folder", source: "host" },
          { name: "host-shared", description: "In the shared folder", source: "host" },
        ],
      });
      // Claude Code reads ~/.claude/skills on its own: it is named, and nothing is installed or sent.
      expect((await say(claude, ["host-native"])).status).toBe(201);
      expect(prompts.at(-1)).toContain(
        "Load each with the Skill tool before you answer: host-native.",
      );
      expect(prompts.at(-1)).not.toContain("native steps");
      expect(installed["skills/host-native/SKILL.md"]).toBeUndefined();
      // It does not read the shared folder: the skill is installed in the run's plugin dir and loaded with the Skill tool.
      expect((await say(claude, ["host-shared"])).status).toBe(201);
      expect(prompts.at(-1)).toContain(
        "Load each with the Skill tool before you answer: zetta-bot:host-shared.",
      );
      expect(prompts.at(-1)).not.toContain("shared steps");
      expect(installed["skills/host-shared/SKILL.md"]).toContain("shared steps");
      // A harness with no skill option is told to use them and where their SKILL.md is; the text stays out of the prompt.
      expect((await say(plain, ["host-native", "host-shared"])).status).toBe(201);
      expect(prompts.at(-1)).toContain(
        `host-native (SKILL.md at ${join(home, ".claude/skills/host-native/SKILL.md")}), host-shared (SKILL.md at ${join(home, ".agents/skills/host-shared/SKILL.md")}). Use each one before you answer`,
      );
      expect(prompts.at(-1)).not.toContain("native steps");
      expect(prompts.at(-1)).not.toContain("shared steps");
      expect(prompts.at(-1)).not.toContain("Skill tool");
    } finally {
      if (was.home === undefined) delete process.env.HOME;
      else process.env.HOME = was.home;
      if (was.on === undefined) delete process.env.ZETTA_HOST_SKILLS;
      else process.env.ZETTA_HOST_SKILLS = was.on;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("journey: successful task -> reusable wiki procedure -> routine -> first occurrence -> durable result", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Worker", harness: "pi" })).json.bot;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation.id;
    script.push(
      'Here is the weekly summary.\n```zetta:wiki\n{"action":"write","slug":"weekly-metrics-summary","title":"Weekly metrics summary","tags":["instruction"],"howto":"the weekly metrics summary","content":"1) pull metrics 2) compare to last week 3) three bullets"}\n```',
    );
    const first = await call("POST", `/api/conversations/${conv}/messages`, {
      content: "Summarize this week's metrics",
    });
    // The bot can run code and the message did not ask to save anything, so the item waits for the person's approval.
    expect(first.json.assistant.meta.receipts[0]).toMatchObject({
      kind: "proposal",
      text: "Weekly metrics summary",
    });
    expect(
      (
        await call("POST", `/api/proposals/${first.json.assistant.meta.receipts[0].id}/decision`, {
          approve: true,
        })
      ).json.status,
    ).toBe("approved");
    const ins = (await call("GET", "/api/wiki")).json.pages.find(
      (i: { title: string }) => i.title === "Weekly metrics summary",
    );
    expect(ins).toMatchObject({ tags: ["instruction"], type: "owner" });
    // the procedure is shown for similar later work, and the answer says what it used
    prompts.length = 0;
    const second = await call("POST", `/api/conversations/${conv}/messages`, {
      content: "Do the weekly metrics summary again",
    });
    expect(prompts.at(-1)).toContain("pull metrics");
    expect(second.json.assistant.meta.used.instructions).toHaveLength(1);
    // make it recurring: the routine summary explains task, bot, timezone/next run, context mode, accounts and destination before activation
    const routine = (
      await call("POST", "/api/routines", {
        botId: bot.id,
        title: "Weekly metrics",
        prompt: "Do the weekly metrics summary",
        timezone: "Europe/Lisbon",
        dailyAt: "08:00",
        conversationMode: "new",
      })
    ).json.routine;
    const sum = (await call("GET", `/api/routines/${routine.id}/summary`)).json.summary;
    expect(sum).toMatchObject({
      bot: "Worker",
      timezone: "Europe/Lisbon",
      contextMode: "All runs share one chat; the bot reads only the run before",
      missing: [],
    });
    expect(sum.nextRuns).toHaveLength(3);
    await call("POST", `/api/routines/${routine.id}/paused`, { paused: false });
    script.push("Weekly result: three bullets.");
    const done = (
      await call("POST", `/api/routines/${routine.id}/run`, { requestKey: "first-occurrence-001" })
    ).json.run;
    expect(done.status).toBe("succeeded");
    const result = (await call("GET", `/api/conversations/${done.conversationId}/messages`)).json
      .messages;
    expect(result.at(-1).content).toBe("Weekly result: three bullets."); // durable result in a chat the owner can open
  });

  test("journey: wrong result -> inspect knowledge used -> correct it -> improved later context", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Fact", harness: "pi" })).json.bot;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const note = (content: string, expectedVersion: number) =>
      call("PUT", "/api/wiki/office-hours", {
        title: "Office hours",
        content,
        type: "solo",
        authorBotId: bot.id,
        tags: ["memory"],
        expectedVersion,
      });
    expect((await note("The office closes at 17:00 on Fridays", 0)).status).toBe(200);
    const mem = {
      id: (await call("GET", "/api/wiki")).json.pages.find(
        (p: { slug: string }) => p.slug === "office-hours",
      ).id as string,
    };
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation.id;
    const wrong = await call("POST", `/api/conversations/${conv}/messages`, {
      content: "When does the office close on Fridays?",
    });
    const used = (await call("GET", `/api/messages/${wrong.json.assistant.id}/knowledge`)).json;
    expect(used.memories.map((m: { id: string }) => m.id)).toContain(mem.id); // the person can see which note drove the answer
    expect((await note("The office closes at 15:00 on Fridays", 1)).status).toBe(200);
    prompts.length = 0;
    // memory is frozen per conversation (stable prompt prefix): the correction shows in the next conversation
    const conv2 = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id;
    await call("POST", `/api/conversations/${conv2}/messages`, {
      content: "When does the office close on Fridays?",
    });
    expect(prompts.at(-1)).toContain("15:00");
    expect(prompts.at(-1)).not.toContain("17:00");
  });

  test("journey: blocked task -> repair -> return to the retained work -> deliberate next attempt; screens agree", async () => {
    const bot = (await call("POST", "/api/bots", { name: "Blocked", harness: "cursor" })).json.bot; // cursor-agent is not installed here
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const routine = (
      await call("POST", "/api/routines", {
        botId: bot.id,
        title: "Daily intake",
        prompt: "intake",
        timezone: "UTC",
        everyMinutes: 60,
      })
    ).json.routine;
    await call("POST", `/api/routines/${routine.id}/paused`, { paused: false });
    const failed = (
      await call("POST", `/api/routines/${routine.id}/run`, { requestKey: "blocked-attempt-01" })
    ).json.run;
    expect(failed.status).toBe("failed");
    const card = (await call("GET", "/api/attention")).json.items.find((i: { title: string }) =>
      i.title.includes('"Daily intake" failed'),
    );
    expect(card).toMatchObject({ status: "open", resultLink: expect.stringContaining("/chat/") });
    const summary = (await call("GET", "/api/attention/summary")).json.summary;
    expect(summary.open).toBe(
      (await call("GET", "/api/attention")).json.items.filter(
        (i: { status: string }) => i.status === "open",
      ).length,
    ); // sidebar badge == kanban column
    const activity = (await call("GET", "/api/activity")).json.events;
    expect(
      activity.some(
        (e: { kind: string; outcome: string }) =>
          e.kind === "routine_run" && e.outcome === "failed",
      ),
    ).toBe(true); // same fact in the activity trail
    // acknowledging does not make the run succeed
    await call("POST", `/api/attention/${card.id}/action`, { action: "acknowledge" });
    expect((await call("GET", `/api/routines/${routine.id}/runs`)).json.runs[0].status).toBe(
      "failed",
    );
    // repair: switch the bot to a working harness, then retry deliberately (a NEW request key; the old attempt is retained)
    await call("PATCH", `/api/bots/${bot.id}`, { expectedVersion: 1, patch: { harness: "pi" } });
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]); // stands in for the explicit satisfaction check
    script.push("Intake handled.");
    const retry = (
      await call("POST", `/api/routines/${routine.id}/run`, { requestKey: "deliberate-retry-02" })
    ).json.run;
    expect(retry.status).toBe("succeeded");
    expect(retry.id).not.toBe(failed.id);
    const history = (await call("GET", `/api/routines/${routine.id}/runs`)).json.runs.map(
      (r: { status: string }) => r.status,
    );
    expect(history).toEqual(["succeeded", "failed"]); // the earlier attempt is kept
    await call("POST", `/api/attention/${card.id}/action`, { action: "resolve" });
    expect((await call("GET", "/api/attention/summary")).json.summary.open).toBeLessThan(
      summary.open + 1,
    );
  });
});

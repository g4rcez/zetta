import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createArtifactStore } from "../artifacts/store";
import { createBotClaude } from "../bot-claude/store";
import { createFeaturesService } from "../features/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createOutputStyles } from "../output-styles/service";
import { createPreferenceStore } from "../preferences/store";
import { createSkills } from "../skills/service";
import { createTaskStore } from "../tasks/store";
import { createTeamStore } from "../teams/store";
import { createWiki } from "../wiki/service";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`chief-a-${uuidv7()}`, `chief-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("the chief changes the user's setup, one approved card at a time", () => {
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
  let script: string[] = [];
  const prompts: string[] = [];
  const fakeRun = Object.assign(
    async (t: { prompt: string }) => {
      prompts.push(t.prompt);
      return { text: script.shift() ?? "done", stopped: false };
    },
    {
      stream: async function* (t: { prompt: string }) {
        prompts.push(t.prompt);
        yield script.shift() ?? "done";
      },
    },
  );
  const features = createFeaturesService(db, fakeRun as never);
  const teamStore = createTeamStore(db, {} as never);
  const outputStyles = createOutputStyles(db);
  const tasks = createTaskStore(db);
  // The bot database needs CREATEROLE on the server's database user: a recording fake stands in for it.
  const dbCalls: string[] = [];
  const dbFake = {
    ensure: async () => "",
    setAccess: async (_botId: string, on: boolean) => {
      dbCalls.push(`access ${on}`);
      return { access: on };
    },
    applyTemplate: async (_botId: string, t: string) => {
      dbCalls.push(`template ${t}`);
      return {} as never;
    },
  } as never;
  let artifacts: ReturnType<typeof createArtifactStore>;
  let chatSvc: ReturnType<typeof createChatService>;
  let app: ReturnType<typeof createApp>;
  const actorOf = (id: string) =>
    issueBackgroundActor(async () => ({ isAdmin: false }) as never, id);

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

  beforeAll(async () => {
    artifacts = createArtifactStore(db, await mkdtemp(join(tmpdir(), "zetta-chief-")));
    chatSvc = createChatService(
      db,
      fakeRun as never,
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
        teams: teamStore,
        routines: features.routines,
        outputStyles,
        artifacts,
        tasks,
        features,
        preferences: createPreferenceStore(db),
        botClaude: createBotClaude(db),
        skills: { skills: createSkills(db), market: {} as never },
        botDatabase: dbFake,
        wiki: createWiki(db),
      },
    );
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: { access, chat: chatSvc },
      features: { access, features },
      teams: { access, store: teamStore } as never,
      webOrigin: "http://web.test",
      desktopOrigins: [],
      drain: () => {},
    });
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

  /** The user's chief, switched to an engine that runs the scripted replies, with one open chat. */
  const chiefOf = async (as: string) => {
    const found = (
      (await call(as, "GET", "/api/bots")).json.bots as {
        id: string;
        kind: string;
        version: number;
      }[]
    ).find((b) => b.kind === "chief")!;
    const chief = (
      await call(as, "PATCH", `/api/bots/${found.id}`, {
        expectedVersion: found.version,
        patch: { harness: "codex" },
      })
    ).json.bot as { id: string };
    const c = (await call(as, "POST", "/api/conversations", { botId: chief.id })).json.conversation
      .id as string;
    return {
      chief,
      say: async (reply: string[], content: string) => {
        script = reply;
        return (await call(as, "POST", `/api/conversations/${c}/messages`, { content })).json
          .assistant.content as string;
      },
    };
  };
  const pending = async (as: string) =>
    (await call(as, "GET", "/api/proposals")).json.proposals as {
      id: string;
      kind: string;
      diff: { field: string; to: unknown }[];
      patch: { title: string };
    }[];
  const approve = (as: string, id: string) =>
    call(as, "POST", `/api/proposals/${id}/decision`, { approve: true });
  const bots = async (as: string) =>
    (await call(as, "GET", "/api/bots")).json.bots as {
      id: string;
      name: string;
      version: number;
      computerMode: string;
      personality: string;
    }[];

  test("a new routine waits for the user, then exists and is switched on once approved", async () => {
    const { say } = await chiefOf(A);
    await say(
      ['```zetta:create_bot\n{"name":"Scout","personality":"curious"}\n```'],
      "make a researcher",
    );
    const reply = await say(
      [
        '```zetta:routine\n{"action":"create","bot":"Scout","title":"Morning digest","prompt":"Read the news and summarise it","timezone":"America/Sao_Paulo","dailyAt":"08:00"}\n```',
      ],
      "every morning at 8 send me a digest",
    );
    expect(reply).toContain("Proposed: New routine Morning digest");
    const actor = (await actorOf(A))!;
    expect(await features.routines.list(actor)).toEqual([]);
    const [p] = await pending(A);
    expect(p).toMatchObject({
      kind: "chief_action",
      patch: { title: "New routine Morning digest" },
    });
    expect(p!.diff.map((d) => d.field)).toEqual([
      "bot",
      "title",
      "schedule",
      "prompt",
      "switch on",
    ]);

    expect((await approve(A, p!.id)).json.status).toBe("approved");
    const [made] = await features.routines.list(actor);
    expect(made).toMatchObject({ title: "Morning digest", dailyAt: "08:00", paused: false });
    expect(await pending(A)).toEqual([]);
  });

  test("the chief can read the routines and then ask to pause one in the same turn", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        '```zetta:routine\n{"action":"list"}\n```',
        '```zetta:routine\n{"action":"pause","routine":"Morning digest"}\n```',
      ],
      "pause my digest",
    );
    expect(prompts.join("\n")).toContain('"title":"Morning digest"');
    const [p] = await pending(A);
    expect(p?.patch.title).toBe("Pause routine Morning digest");
    const actor = (await actorOf(A))!;
    expect((await features.routines.list(actor))[0]?.paused).toBe(false);

    await approve(A, p!.id);
    expect((await features.routines.list(actor))[0]?.paused).toBe(true);
  });

  test("changing a bot's computer waits for the user, then applies", async () => {
    const { say } = await chiefOf(A);
    await say(
      ['```zetta:bot\n{"action":"update","bot":"Scout","computerMode":"browser"}\n```'],
      "give Scout a browser",
    );
    expect((await bots(A)).find((b) => b.name === "Scout")?.computerMode).toBe("off");
    const [p] = await pending(A);
    expect(p!.diff.find((d) => d.field === "computerMode")).toMatchObject({ to: "browser" });
    await approve(A, p!.id);
    expect((await bots(A)).find((b) => b.name === "Scout")?.computerMode).toBe("browser");
  });

  test("a card is stale when the bot changed after the chief asked", async () => {
    const { say } = await chiefOf(A);
    await say(
      ['```zetta:bot\n{"action":"update","bot":"Scout","personality":"calm and short"}\n```'],
      "make Scout calmer",
    );
    const [p] = await pending(A);
    const scout = (await bots(A)).find((b) => b.name === "Scout")!;
    await call(A, "PATCH", `/api/bots/${scout.id}`, {
      expectedVersion: scout.version,
      patch: { description: "edited by hand" },
    });
    expect((await approve(A, p!.id)).json.status).toBe("stale");
    expect((await bots(A)).find((b) => b.name === "Scout")?.personality).toBe("curious");
  });

  test("a team loses a member and gains another with a role", async () => {
    const { say } = await chiefOf(A);
    await say(
      [
        '```zetta:create_bot\n{"name":"Coder","personality":"senior"}\n```\n```zetta:create_team\n{"name":"Launch","goal":"ship","members":[{"bot":"Scout"}]}\n```',
      ],
      "make a launch team",
    );
    await say(
      [
        '```zetta:team\n{"action":"update","team":"Launch","add":[{"bot":"Coder","role":"Developer"}],"remove":["Scout"]}\n```',
      ],
      "swap Scout for Coder",
    );
    const [p] = await pending(A);
    expect(p!.diff.map((d) => d.field)).toEqual(["team", "remove member", "add member"]);
    await approve(A, p!.id);
    const team = (
      (await call(A, "GET", "/api/teams")).json.teams as {
        name: string;
        members: { name: string; kind: string; role: string }[];
      }[]
    ).find((t) => t.name === "Launch")!;
    expect(team.members.map((m) => `${m.name}:${m.kind}:${m.role}`).sort()).toEqual([
      "Coder:member:Developer",
      "Zetta:chief:",
    ]);
  });

  test("an output style is created only after the user approves it", async () => {
    const { say } = await chiefOf(A);
    await say(
      [
        '```zetta:output_style\n{"action":"create","name":"Plain","description":"two lines","body":"Answer in two short lines."}\n```',
      ],
      "make a plain style",
    );
    expect((await outputStyles.list(A)).styles).toEqual([]);
    const [p] = await pending(A);
    await approve(A, p!.id);
    expect((await outputStyles.list(A)).styles.map((s) => s.name)).toEqual(["Plain"]);
  });

  test("a task is deleted and an artifact is unpinned only after approval", async () => {
    const actor = (await actorOf(A))!;
    const t = await tasks.create(actor, { title: "Old chore" });
    const art = await artifacts.publish(actor, {
      title: "Sales sheet",
      source: { content: "a,b" },
    });
    await artifacts.setPinned(actor, art.id, true);
    const { say } = await chiefOf(A);
    await say(
      [
        `\`\`\`zetta:task\n{"action":"remove","id":"${t.id}"}\n\`\`\`\n\`\`\`zetta:artifacts\n{"action":"unpin","artifact":"Sales sheet"}\n\`\`\``,
      ],
      "drop the old chore and unpin the sales sheet",
    );
    expect(await tasks.list(actor)).toHaveLength(1);
    expect((await artifacts.get(actor, art.id)).pinnedAt).not.toBeNull();
    for (const p of await pending(A)) await approve(A, p.id);
    expect(await tasks.list(actor)).toHaveLength(0);
    expect((await artifacts.get(actor, art.id)).pinnedAt).toBeNull();
  });

  test("a bot that is not the chief cannot ask for any of it", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Helper" })).json.bot as { id: string };
    const c = (await call(A, "POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    script = ['```zetta:routine\n{"action":"remove","routine":"Morning digest"}\n```'];
    prompts.length = 0;
    await call(A, "POST", `/api/conversations/${c}/messages`, { content: "delete the digest" });
    expect(prompts.join("\n")).toContain("only the chief can do this");
    expect(await pending(A)).toEqual([]);
  });

  test("a change asked for after the chief read outside text is ignored", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        '```zetta:wiki\n{"action":"search","query":"digest"}\n```',
        '```zetta:routine\n{"action":"remove","routine":"Morning digest"}\n```',
      ],
      "look it up and delete the digest",
    );
    expect(prompts.join("\n")).toContain(
      "changes requested after reading outside content are ignored",
    );
    expect(await pending(A)).toEqual([]);
  });

  test("one user's chief cannot see or change another user's setup", async () => {
    const { say } = await chiefOf(B);
    prompts.length = 0;
    await say(['```zetta:routine\n{"action":"pause","routine":"Morning digest"}\n```'], "pause it");
    expect(prompts.join("\n")).toContain('no routine called "Morning digest"');
    expect(await pending(B)).toEqual([]);
  });
  test("a hook is added to a bot only after the user approves it", async () => {
    const { say } = await chiefOf(A);
    const scout = (await bots(A)).find((b) => b.name === "Scout")!;
    await say(
      [
        '```zetta:hook\n{"action":"add","bot":"Scout","kind":"stop","pattern":"password","value":"Never send passwords here."}\n```',
      ],
      "block passwords for Scout",
    );
    const actor = (await actorOf(A))!;
    expect(await features.listHooks(actor, scout.id)).toEqual([]);
    const [p] = await pending(A);
    await approve(A, p!.id);
    const hooks = await features.listHooks(actor, scout.id);
    expect(hooks.map((h) => [h.kind, h.pattern, h.enabled])).toEqual([["stop", "password", true]]);
  });

  test("a skill is created and a Claude Code bot gets a spending limit, each after approval", async () => {
    const { say } = await chiefOf(A);
    await say(
      ['```zetta:create_bot\n{"name":"Dev","personality":"careful","harness":"claude-code"}\n```'],
      "make a developer on Claude Code",
    );
    await say(
      [
        '```zetta:skill_library\n{"action":"create","name":"code-review","description":"Reviews a diff","body":"Read the diff and list bugs."}\n```\n```zetta:claude\n{"action":"limits","bot":"Dev","effort":"high","maxBudgetCents":500}\n```',
      ],
      "add a review skill and cap Dev at five dollars",
    );
    const actor = (await actorOf(A))!;
    const dev = (await bots(A)).find((b) => b.name === "Dev")!;
    const claude = createBotClaude(db);
    expect((await claude.get(dev.id)).config).toMatchObject({ effort: null, maxBudgetCents: null });
    for (const p of await pending(A)) await approve(A, p.id);
    expect((await claude.get(dev.id)).config).toMatchObject({
      effort: "high",
      maxBudgetCents: 500,
    });
    expect((await createSkills(db).list(actor)).map((s) => s.name)).toEqual(["code-review"]);
  });

  test("claude settings are refused for a bot that does not run on Claude Code", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      ['```zetta:claude\n{"action":"list","bot":"Scout"}\n```'],
      "show Scout's claude settings",
    );
    expect(prompts.join("\n")).toContain("does not run on Claude Code");
  });

  test("a bot's database is switched with a card, and erased only through a form the user fills in", async () => {
    const { say } = await chiefOf(A);
    dbCalls.length = 0;
    await say(
      ['```zetta:bot_database\n{"action":"access","bot":"Scout","on":true}\n```'],
      "turn on Scout's database",
    );
    expect(dbCalls).toEqual([]);
    const [p] = await pending(A);
    await approve(A, p!.id);
    expect(dbCalls).toEqual(["access true"]);

    const reply = await say(
      ['```zetta:bot_database\n{"action":"reset","bot":"Scout"}\n```'],
      "erase Scout's database",
    );
    expect(reply).toContain("```zetta:form-card");
    expect(reply).toContain('"form":"bot_database_reset"');
    expect(reply).toContain('"botName":"Scout"');
    expect(await pending(A)).toEqual([]);
    expect(dbCalls).toEqual(["access true"]);
  });

  test("a form card the model writes itself is never shown", async () => {
    const { say } = await chiefOf(A);
    const reply = await say(
      [
        'Here you go.\n```zetta:form-card\n{"form":"bot_database_reset","botId":"x","botName":"Scout","prefill":{}}\n```',
      ],
      "show a form",
    );
    expect(reply).not.toContain("zetta:form-card");
  });
  test("display preferences change only after approval", async () => {
    const { say } = await chiefOf(A);
    await say(
      ['```zetta:preferences\n{"action":"update","timeFormat":"12h"}\n```'],
      "use 12 hour time",
    );
    const store = createPreferenceStore(db);
    const actor = (await actorOf(A))!;
    expect((await store.get(actor)).timeFormat).toBe("24h");
    const [p] = await pending(A);
    await approve(A, p!.id);
    expect((await store.get(actor)).timeFormat).toBe("12h");
  });

  test("a chat is renamed and then deleted, each after approval", async () => {
    const { say } = await chiefOf(A);
    const scout = (await bots(A)).find((b) => b.name === "Scout")!;
    const made = (await call(A, "POST", "/api/conversations", { botId: scout.id })).json
      .conversation as { id: string };
    await say(
      [
        `\`\`\`zetta:conversation\n{"action":"rename","conversation":"${made.id}","title":"Q4 plan"}\n\`\`\``,
      ],
      "rename it",
    );
    const titleOf = async () =>
      (
        (await call(A, "GET", `/api/conversations?botId=${scout.id}`)).json.conversations as {
          id: string;
          title: string;
        }[]
      ).find((c) => c.id === made.id)?.title;
    const before = await titleOf();
    for (const p of await pending(A)) await approve(A, p.id);
    expect(await titleOf()).toBe("Q4 plan");
    expect(before).not.toBe("Q4 plan");
    await say(
      [`\`\`\`zetta:conversation\n{"action":"remove","conversation":"${made.id}"}\n\`\`\``],
      "delete it",
    );
    expect(await titleOf()).toBe("Q4 plan");
    for (const p of await pending(A)) await approve(A, p.id);
    expect(await titleOf()).toBeUndefined();
  });

  test("computers say so when the server has none", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(['```zetta:computer\n{"action":"vms"}\n```'], "list my computers");
    expect(prompts.join("\n")).toContain("computers are not available on this server");
  });

  test("a permission grant waits for the click even when the user's message talks about saving", async () => {
    const { say } = await chiefOf(A);
    await say(
      ['```zetta:create_bot\n{"name":"Ops","personality":"careful","harness":"claude-code"}\n```'],
      "make an ops bot on Claude Code",
    );
    const ops = (await bots(A)).find((b) => b.name === "Ops")!;
    // "always" is one of the words that let a memory write apply at once; a permission grant must not follow that rule.
    await say(
      ['```zetta:bot_claude\n{"bot":"Ops","allow":["Bash(rm:*)"]}\n```'],
      "Always let Ops delete its build folder",
    );
    const claude = createBotClaude(db);
    expect((await claude.get(ops.id)).config.allow).not.toContain("Bash(rm:*)");
    const [p] = await pending(A);
    expect(p).toMatchObject({ kind: "bot_permission" });
    await approve(A, p!.id);
    expect((await claude.get(ops.id)).config.allow).toContain("Bash(rm:*)");
  });
});

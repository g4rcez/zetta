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
import { createProfileStore } from "../profile/store";
import { createProjectStore } from "../projects/store";
import { createSkills } from "../skills/service";
import { createTaskStore } from "../tasks/store";
import { createDiscussionStore } from "../discussions/store";
import { createTeamStore } from "../teams/store";
import { createMemory } from "../memory/service";
import { topics } from "@zetta/core/live-topics";
import { events } from "../events/bus";
import { createLoopStore } from "./loops";
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
  const discussions = createDiscussionStore(db, undefined, createLoopStore(db));
  const teamStore = createTeamStore(db, discussions);
  const outputStyles = createOutputStyles(db);
  const tasks = createTaskStore(db);
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
        profile: createProfileStore(db),
        projects: createProjectStore(db),
        botClaude: createBotClaude(db),
        skills: { skills: createSkills(db), market: {} as never },
        memory: createMemory(db),
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

  test("the chief's own write after a tool result applies at once, with no bot_action card", async () => {
    const { say } = await chiefOf(B);
    await say(
      [
        '```zetta:task\n{"action":"list"}\n```',
        '```zetta:task\n{"action":"add","title":"Chief plans the launch"}\n```',
      ],
      "plan the launch",
    );
    expect((await pending(B)).filter((p) => p.kind === "bot_action")).toEqual([]);
    const actor = (await actorOf(B))!;
    expect((await tasks.list(actor)).map((t) => t.title)).toContain("Chief plans the launch");
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

  test("a team build: bots and a team with context exist at once and the cards of the next round are kept", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        '```zetta:create_bot\n{"name":"Dana","personality":"analyst"}\n```\n```zetta:create_bot\n{"name":"Eli","personality":"writer"}\n```\n```zetta:create_team\n{"name":"Atlas","goal":"Ship the blog","context":"We publish on Fridays.","members":[{"bot":"Dana"},{"bot":"Eli"}]}\n```',
        '```zetta:team\n{"action":"role_create","name":"Analyst","description":"Reads the numbers"}\n```\n```zetta:skill_library\n{"action":"create","name":"atlas-playbook","description":"How Atlas works","body":"Publish on Fridays."}\n```',
      ],
      "build a team called Atlas for the blog",
    );
    const team = (
      (await call(A, "GET", "/api/teams")).json.teams as {
        name: string;
        goal: string;
        context: string;
        members: { name: string }[];
      }[]
    ).find((t) => t.name === "Atlas")!;
    expect(team.goal).toBe("Ship the blog");
    expect(team.context).toBe("We publish on Fridays.");
    expect(team.members.map((m) => m.name).sort()).toEqual(["Dana", "Eli", "Zetta"]);
    expect((await pending(A)).map((p) => p.patch.title).sort()).toEqual([
      "New skill atlas-playbook",
      "New team role Analyst",
    ]);
    expect(prompts.join("\n")).not.toContain("ignored");
    // Decided so no card is left for the next test; the skill is declined to keep the library as the other tests expect it.
    for (const p of await pending(A))
      await call(A, "POST", `/api/proposals/${p.id}/decision`, {
        approve: p.patch.title.includes("role"),
      });
  });

  test("the project room is a card; once approved it is linked to the team, has its members and wakes nobody", async () => {
    const { say } = await chiefOf(A);
    await say(
      [
        '```zetta:team\n{"action":"open_room","team":"Atlas","title":"Blog launch","goal":"Publish the first post","context":"Audience: developers."}\n```',
      ],
      "open the project room",
    );
    const [card] = await pending(A);
    expect(card!.patch.title).toBe('Open room "Blog launch" for team Atlas');
    const rooms = () =>
      db.$client.query(
        "select d.id, d.goal, d.context, d.team_id is not null as linked, (select count(*)::int from discussion_member m where m.discussion_id = d.id) as members, (select count(*)::int from discussion_turn t where t.discussion_id = d.id) as turns from discussion d where d.owner_user_id = $1 and d.title = 'Blog launch'",
        [A],
      );
    expect((await rooms()).rows).toEqual([]);
    await approve(A, card!.id);
    const [room] = (await rooms()).rows;
    expect(room).toMatchObject({
      goal: "Publish the first post",
      context: "Audience: developers.",
      linked: true,
      members: 3,
      turns: 0,
    });
  });

  test("a second room with the same title is refused before any card, and an empty team has no room", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        '```zetta:team\n{"action":"open_room","team":"Atlas","title":"blog LAUNCH","goal":"again"}\n```',
      ],
      "open the project room again",
    );
    expect(prompts.join("\n")).toContain('A team room called "blog LAUNCH" already exists');
    expect(await pending(A)).toEqual([]);
  });

  test("only one change per team waits at a time", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        '```zetta:team\n{"action":"update","team":"Atlas","goal":"Ship the blog and the newsletter"}\n```\n```zetta:team\n{"action":"update","team":"Atlas","context":"We publish on Mondays."}\n```',
      ],
      "change the team goal and context",
    );
    expect((await pending(A)).map((p) => p.patch.title)).toEqual(["Change team Atlas"]);
    expect(prompts.join("\n")).toContain('A change to "Atlas" already waits');
    for (const p of await pending(A)) await approve(A, p.id);
  });

  /** Waits until `cond` holds: a wave continues in the background after the user's click. */
  const until = async (cond: () => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const quiet = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const block = (kind: string, json: object) =>
    "```zetta:" + kind + "\n" + JSON.stringify(json) + "\n```";
  const decide = (id: string, approve: boolean) =>
    call(A, "POST", `/api/proposals/${id}/decision`, { approve });

  test("waves: once the user decided every card of a step the chief is called again with the result, once", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        block("team", { action: "role_create", name: "Scribe", description: "Writes the posts" }) +
          block("team", {
            action: "role_create",
            name: "Proofreader",
            description: "Checks them",
          }) +
          block("next_wave", { next: "give Dana the Scribe role" }),
        "Step one waits for your approval.",
      ],
      "start the team setup",
    );
    expect(prompts.join("\n")).toContain("next_wave: noted");
    const cards = await pending(A);
    expect(cards.map((c) => c.patch.title).sort()).toEqual([
      "New team role Proofreader",
      "New team role Scribe",
    ]);
    const before = prompts.length;
    script = ["Step two: sent."];
    await decide(cards.find((c) => c.patch.title.includes("Scribe"))!.id, true);
    await quiet();
    expect(prompts.length).toBe(before); // one card still waits: nothing yet
    await decide(cards.find((c) => c.patch.title.includes("Proofreader"))!.id, false);
    await until(() => prompts.length > before);
    await quiet();
    const next = prompts.at(-1)!;
    expect(next).toContain("The user decided the cards of your step 1.");
    expect(next).toContain("Approved: New team role Scribe.");
    expect(next).toContain("Rejected: New team role Proofreader.");
    expect(next).toContain("give Dana the Scribe role");
    expect(prompts.length).toBe(before + 1); // one continuation, no more
  });

  test("waves: two cards decided at the same moment start one continuation", async () => {
    const { say } = await chiefOf(A);
    await say(
      [
        block("team", { action: "role_create", name: "Courier", description: "Moves files" }) +
          block("team", { action: "role_create", name: "Archivist", description: "Keeps files" }) +
          block("next_wave", { next: "carry on" }),
        "Waiting.",
      ],
      "start another setup",
    );
    const cards = await pending(A);
    const before = prompts.length;
    script = ["Carried on."];
    await Promise.all(cards.map((c) => decide(c.id, false)));
    await until(() => prompts.length > before);
    await quiet(800);
    expect(prompts.length).toBe(before + 1);
  });

  test("a turn that leaves a card waiting tells the open page, so a card from a turn nobody follows still shows at once", async () => {
    const { say } = await chiefOf(A);
    const told: string[] = [];
    const stop = events.subscribe(A, (topic) => told.push(topic));
    await say(
      [block("team", { action: "role_create", name: "Notified", description: "x" }), "Waiting."],
      "one card, then wait",
    );
    await quiet(600);
    stop();
    expect(told).toContain(topics.proposals);
    for (const p of await pending(A)) await decide(p.id, false);
  });

  test("waves: a card sent without next_wave never calls the chief again", async () => {
    const { say } = await chiefOf(A);
    await say(
      [block("team", { action: "role_create", name: "Lonely", description: "x" }), "Waiting."],
      "one plain card",
    );
    const [card] = await pending(A);
    const before = prompts.length;
    await decide(card!.id, false);
    await quiet(600);
    expect(prompts.length).toBe(before);
  });

  test("waves: a team build has at most four steps; next_wave in the last one is refused", async () => {
    const { say } = await chiefOf(A);
    const step = (n: number) =>
      block("team", { action: "role_create", name: `Step${n}`, description: "x" }) +
      block("next_wave", { next: `do step ${n + 1}` });
    prompts.length = 0;
    script = [
      step(1),
      "Waiting 1.",
      step(2),
      "Waiting 2.",
      step(3),
      "Waiting 3.",
      step(4),
      "Waiting 4.",
    ];
    await say(script.slice(), "build it in steps");
    for (let n = 1; n <= 3; n++) {
      const calls = prompts.length;
      const [card] = await pending(A);
      await decide(card!.id, false);
      await until(() => prompts.length >= calls + 2);
      await quiet();
    }
    expect(prompts.join("\n")).toContain("this is already step 4, the last one");
    const [last] = await pending(A);
    const calls = prompts.length;
    await decide(last!.id, false);
    await quiet(600);
    expect(prompts.length).toBe(calls); // the fourth step set no mark: nothing follows
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

  test("the chief adds and removes the people of a team, one card each, and the owner cannot be removed", async () => {
    const actor = (await actorOf(A))!;
    const made = await teamStore.create(actor, {
      name: `People crew ${uuidv7().slice(-6)}`,
      goal: "",
      canvas: { x: 0, y: 0, w: 360, h: 280 },
    });
    const { say, chief } = await chiefOf(A);
    const people = async () => (await teamStore.people(actor, made.id)).map((p) => p.userId);
    expect(await people()).toEqual([A]);

    prompts.length = 0;
    await say(
      [`\`\`\`zetta:team\n{"action":"add_people","team":"${made.name}","people":["${B}"]}\n\`\`\``],
      "add B to the team",
    );
    const [card] = await pending(A);
    expect(card).toMatchObject({
      kind: "chief_action",
      patch: { tool: "team", op: "add_people" },
    });
    expect(card!.diff.map((d) => [d.field, d.to])).toEqual([["add person", B]]);
    expect(await people()).toEqual([A]);
    // Adding a person is answered each time: "Always allow" saves no rule.
    expect((await approve(A, card!.id)).json.status).toBe("approved");
    expect(await people()).toEqual([A, B]);

    // The team read shows bots and people, and nobody is added twice.
    prompts.length = 0;
    await say([`\`\`\`zetta:team\n{"action":"get","team":"${made.name}"}\n\`\`\``], "who is in it");
    expect(prompts.join("\n")).toContain(`"userId":"${B}"`);
    await say(
      [`\`\`\`zetta:team\n{"action":"add_people","team":"${made.name}","people":["${B}"]}\n\`\`\``],
      "add B again",
    );
    expect(prompts.join("\n")).toContain("they are already in the team");
    expect(await pending(A)).toEqual([]);

    // The owner stays; a member goes with a card.
    prompts.length = 0;
    await say(
      [
        `\`\`\`zetta:team\n{"action":"remove_people","team":"${made.name}","people":["${A}"]}\n\`\`\``,
      ],
      "remove me",
    );
    expect(prompts.join("\n")).toContain("The owner stays in the team");
    await say(
      [
        `\`\`\`zetta:team\n{"action":"remove_people","team":"${made.name}","people":["${B}"]}\n\`\`\``,
      ],
      "remove B",
    );
    const [out] = await pending(A);
    expect(out!.diff.map((d) => [d.field, d.to])).toEqual([
      ["remove person", "no longer reads the team's rooms"],
    ]);
    expect(
      (
        await call(A, "POST", `/api/proposals/${out!.id}/decision`, {
          approve: true,
          remember: "bot",
        })
      ).json.status,
    ).toBe("approved");
    expect(await people()).toEqual([A]);
    expect((await call(A, "GET", `/api/bots/${chief.id}/approval-rules`)).json.rules).toEqual([]);

    // Another user's chief does not see this team at all.
    const other = await chiefOf(B);
    prompts.length = 0;
    await other.say(
      [`\`\`\`zetta:team\n{"action":"add_people","team":"${made.name}","people":["${B}"]}\n\`\`\``],
      "add myself",
    );
    expect(prompts.join("\n")).toContain("no team called");
    expect(await pending(B)).toEqual([]);
  });

  test("the chief changes the display settings and the name, one card each; how risky cards are approved cannot be changed", async () => {
    const actor = (await actorOf(A))!;
    const prefs = createPreferenceStore(db);
    const profile = createProfileStore(db);
    const { say } = await chiefOf(A);
    await say(
      [
        '```zetta:preferences\n{"action":"update","navMode":"simple","steerMode":"interrupt","theme":null,"primaryColor":"#1A2B3C","railWidth":260}\n```',
      ],
      "simpler menu, my color, wider sidebar",
    );
    const [card] = await pending(A);
    // Only what changes is listed: the theme was already unset.
    expect(card!.diff.map((d) => d.field)).toEqual([
      "navMode",
      "steerMode",
      "railWidth",
      "primaryColor",
    ]);
    expect((await prefs.get(actor)).navMode).toBe("full");
    expect((await approve(A, card!.id)).json.status).toBe("approved");
    expect(await prefs.get(actor)).toMatchObject({
      navMode: "simple",
      steerMode: "interrupt",
      primaryColor: "#1a2b3c",
      railWidth: 260,
      approvalMode: "hold",
    });

    // The guard that protects every card is not a setting a bot can change: the block is turned away before it becomes a card.
    prompts.length = 0;
    await say(
      ['```zetta:preferences\n{"action":"update","approvalMode":"click"}\n```'],
      "just click to approve",
    );
    expect(await pending(A)).toEqual([]);
    expect((await prefs.get(actor)).approvalMode).toBe("hold");

    // The name changes with a card; the read shows the name and never the email.
    const before = (await profile.get(actor)).name;
    await say(
      ['```zetta:preferences\n{"action":"profile","name":"  Ana Souza  "}\n```'],
      "my name is Ana Souza",
    );
    const [named] = await pending(A);
    expect(named!.diff.map((d) => [d.field, d.to])).toEqual([["name", "Ana Souza"]]);
    expect((await profile.get(actor)).name).toBe(before);
    await approve(A, named!.id);
    expect((await profile.get(actor)).name).toBe("Ana Souza");
    prompts.length = 0;
    await say(['```zetta:preferences\n{"action":"get"}\n```'], "what are my settings");
    expect(prompts.join("\n")).toContain('"name":"Ana Souza"');
    expect(prompts.join("\n")).not.toContain("@t.test");

    // A room that does not exist cannot be put in the order.
    prompts.length = 0;
    await say(
      ['```zetta:preferences\n{"action":"update","roomOrder":["No such room"]}\n```'],
      "reorder rooms",
    );
    expect(prompts.join("\n")).toContain('no room called "No such room"');
    expect(await pending(A)).toEqual([]);
  });

  test("the chief reads and edits a workflow: the graph is checked first, one card changes it, and a stale card does nothing", async () => {
    const actor = (await actorOf(A))!;
    const graph = (end: string) => ({
      start: "a",
      nodes: {
        a: { type: "browse", url: "https://example.com/news", next: end },
        [end]: { type: "end" },
      },
    });
    const flow = await features.workflows.save(actor, { name: "News flow", graph: graph("done") });
    const { say } = await chiefOf(A);

    prompts.length = 0;
    await say(
      ['```zetta:workflow\n{"action":"get","workflow":"News flow"}\n```'],
      "show the news flow",
    );
    expect(prompts.join("\n")).toContain("example.com/news");

    // A graph that does not hold together never becomes a card.
    prompts.length = 0;
    await say(
      [
        '```zetta:workflow\n{"action":"update","workflow":"News flow","graph":{"start":"missing","nodes":{"a":{"type":"end"}}}}\n```',
      ],
      "break it",
    );
    expect(prompts.join("\n")).toContain("the graph is not valid");
    expect(await pending(A)).toEqual([]);

    const longer = {
      start: "a",
      nodes: {
        a: { type: "browse", url: "https://example.com/news", next: "b" },
        b: { type: "sources", next: "z" },
        z: { type: "end" },
      },
    };
    await say(
      [
        `\`\`\`zetta:workflow\n${JSON.stringify({ action: "update", workflow: "News flow", name: "News and sources", graph: longer })}\n\`\`\``,
      ],
      "add the sources step",
    );
    const [card] = await pending(A);
    expect(card!.diff.map((d) => [d.field, d.to])).toEqual([
      ["name", "News and sources"],
      ["steps", "3 steps"],
    ]);
    expect((await features.workflows.get(actor, flow.id)).name).toBe("News flow");
    expect((await approve(A, card!.id)).json.status).toBe("approved");
    const saved = await features.workflows.get(actor, flow.id);
    expect(saved).toMatchObject({ name: "News and sources", version: 2 });

    // Somebody saves it in between: the old card cannot overwrite that.
    await say(
      [
        `\`\`\`zetta:workflow\n${JSON.stringify({ action: "update", workflow: "News and sources", name: "Chief name" })}\n\`\`\``,
      ],
      "rename it",
    );
    const [late] = await pending(A);
    await features.workflows.save(actor, {
      id: flow.id,
      name: "Own name",
      graph: longer,
      expectedVersion: 2,
    });
    expect((await approve(A, late!.id)).json.status).toBe("stale");
    expect((await features.workflows.get(actor, flow.id)).name).toBe("Own name");
  });

  test("the chief manages the triggers of a routine; a webhook secret never goes through the chief, only through a form", async () => {
    const actor = (await actorOf(A))!;
    const owner = (await call(A, "POST", "/api/bots", { name: "Trigger owner" })).json.bot as {
      id: string;
    };
    const routine = (await features.routines.create(actor, {
      botId: owner.id,
      title: "Inbox watcher",
      prompt: "Look at what arrived.",
      timezone: "UTC",
      dailyAt: "08:00",
    })) as { id: string };
    const { say } = await chiefOf(A);
    const triggers = () => features.routineTriggers.list(actor, routine.id);

    prompts.length = 0;
    await say(
      ['```zetta:routine\n{"action":"get","routine":"Inbox watcher"}\n```'],
      "what starts it",
    );
    expect(prompts.join("\n")).toContain('"triggers":[]');

    // A webhook makes no card and no trigger: the person gets a form, and the chief is told it never sees the secret.
    prompts.length = 0;
    const reply = await say(
      [
        '```zetta:routine\n{"action":"trigger_add","routine":"Inbox watcher","kind":"webhook"}\n```',
      ],
      "add a webhook",
    );
    expect(reply).toContain("zetta:form-card");
    expect(reply).toContain("routine_triggers");
    expect(prompts.join("\n")).toContain("you never see it");
    expect(await pending(A)).toEqual([]);
    expect(await triggers()).toEqual([]);

    // A Gmail trigger is a card, and exists only once approved.
    await say(
      [
        '```zetta:routine\n{"action":"trigger_add","routine":"Inbox watcher","kind":"gmail","query":"from:boss is:unread"}\n```',
      ],
      "watch my boss",
    );
    const [card] = await pending(A);
    expect(card!.diff.map((d) => d.field)).toEqual(["routine", "starts it when"]);
    expect(await triggers()).toEqual([]);
    expect((await approve(A, card!.id)).json.status).toBe("approved");
    const [gmail] = await triggers();
    expect(gmail).toMatchObject({
      kind: "gmail",
      status: "active",
      filter: { query: "from:boss is:unread" },
    });

    await say(
      [
        `\`\`\`zetta:routine\n{"action":"trigger_pause","routine":"Inbox watcher","trigger":"${gmail!.id}"}\n\`\`\``,
      ],
      "pause it",
    );
    await approve(A, (await pending(A))[0]!.id);
    expect((await triggers())[0]!.status).toBe("paused");

    // An existing webhook: the read shows no secret, replacing it opens the form and changes nothing.
    const made = await features.routineTriggers.create(actor, routine.id, { kind: "webhook" });
    const secret = (made as { secret: string }).secret;
    prompts.length = 0;
    await say(
      ['```zetta:routine\n{"action":"get","routine":"Inbox watcher"}\n```'],
      "list the triggers",
    );
    expect(prompts.join("\n")).not.toContain(secret);
    expect(prompts.join("\n")).not.toContain("secretHash");
    const hook = (await triggers()).find((t) => t.kind === "webhook")!;
    prompts.length = 0;
    const rotate = await say(
      [
        `\`\`\`zetta:routine\n{"action":"trigger_rotate","routine":"Inbox watcher","trigger":"${hook.id}"}\n\`\`\``,
      ],
      "new secret",
    );
    expect(rotate).toContain("zetta:form-card");
    expect(prompts.join("\n")).toContain("you never see it");
    expect(await pending(A)).toEqual([]);
    // The old secret still works: nothing was rotated by the chief.
    // "off" means the secret was accepted and the routine is paused; "invalid" would mean the secret no longer works.
    expect((await features.routineTriggers.receive(hook.id, secret, null, {})).status).not.toBe(
      "invalid",
    );
    expect((await features.routineTriggers.receive(hook.id, "zrt_wrong", null, {})).status).toBe(
      "invalid",
    );

    // Removing one is a card; an unknown id is turned away in words.
    await say(
      [
        `\`\`\`zetta:routine\n{"action":"trigger_remove","routine":"Inbox watcher","trigger":"${gmail!.id}"}\n\`\`\``,
      ],
      "drop the gmail one",
    );
    await approve(A, (await pending(A))[0]!.id);
    expect((await triggers()).map((t) => t.kind)).toEqual(["webhook"]);
    prompts.length = 0;
    await say(
      [
        '```zetta:routine\n{"action":"trigger_remove","routine":"Inbox watcher","trigger":"nope"}\n```',
      ],
      "drop a ghost",
    );
    expect(prompts.join("\n")).toContain("no trigger with that id");
  });

  test("the chief runs the user's projects with cards: create with members by name, change, reorder who works on it, ask for work; only the owner changes one", async () => {
    const actor = (await actorOf(A))!;
    const projects = createProjectStore(db);
    const tag = uuidv7().slice(-6);
    const worker = (await call(A, "POST", "/api/bots", { name: `Worker ${tag}` })).json.bot as {
      id: string;
    };
    const crew = await teamStore.create(actor, {
      name: `Project crew ${tag}`,
      goal: "",
      canvas: { x: 0, y: 0, w: 360, h: 280 },
    });
    await teamStore.addPerson(actor, crew.id, B);
    const { say } = await chiefOf(A);
    const name = `Spring ${tag}`;

    // Create: people and bots are named, the card says who, and nothing exists before the approval.
    await say(
      [
        `\`\`\`zetta:project\n${JSON.stringify({ action: "create", name, outcome: "A launch page and an email", labels: ["Launch", "launch"], bots: [`Worker ${tag}`], people: [B] })}\n\`\`\``,
      ],
      "start the spring project",
    );
    const [card] = await pending(A);
    expect(card!.diff.map((d) => d.field)).toEqual(["name", "outcome", "labels", "bots", "people"]);
    expect((await projects.list(actor)).some((p) => p.name === name)).toBe(false);
    expect((await approve(A, card!.id)).json.status).toBe("approved");
    const made = (await projects.list(actor)).find((p) => p.name === name)!;
    expect(made).toMatchObject({
      role: "owner",
      labels: ["launch"],
      outcome: "A launch page and an email",
    });
    expect(made.bots.map((b) => b.id)).toEqual([worker.id]);
    expect(made.people.map((p) => p.userId)).toEqual([B]);

    // A name that is taken, or a person who is not in the user's teams, never becomes a card.
    prompts.length = 0;
    await say(
      [`\`\`\`zetta:project\n${JSON.stringify({ action: "create", name })}\n\`\`\``],
      "again",
    );
    expect(prompts.join("\n")).toContain("already have a project called");
    await say(
      [
        `\`\`\`zetta:project\n${JSON.stringify({ action: "create", name: `Other ${tag}`, people: ["Nobody Here"] })}\n\`\`\``,
      ],
      "with a stranger",
    );
    expect(prompts.join("\n")).toContain('no person of your teams called "Nobody Here"');
    expect(await pending(A)).toEqual([]);

    // Change: only what changes is listed.
    await say(
      [
        `\`\`\`zetta:project\n${JSON.stringify({ action: "update", project: name, status: "paused", outcome: "A launch page and an email" })}\n\`\`\``,
      ],
      "put it on hold",
    );
    const [hold] = await pending(A);
    expect(hold!.diff.map((d) => [d.field, d.to])).toEqual([["status", "paused"]]);
    await approve(A, hold!.id);
    expect((await projects.get(actor, made.id)).status).toBe("paused");

    // Ask for work: the bot is told when the card is approved, and the task is on the project.
    prompts.length = 0;
    await say(
      [
        `\`\`\`zetta:project\n${JSON.stringify({ action: "add_work", project: name, to: { kind: "bot", who: `Worker ${tag}` }, text: "Write the launch email" })}\n\`\`\``,
      ],
      "ask the worker",
    );
    const [work] = await pending(A);
    expect(work!.diff.map((d) => d.field)).toEqual(["project", "bot", "asks", "note"]);
    expect((await tasks.list(actor)).some((t) => t.title === "Write the launch email")).toBe(false);
    expect((await approve(A, work!.id)).json.status).toBe("approved");
    const task = (await tasks.list(actor)).find((t) => t.title === "Write the launch email")!;
    expect(task).toMatchObject({ projectId: made.id });
    // The bot was told about the task and runs its own turn now: wait for it, so it cannot take the next scripted reply.
    for (let i = 0; i < 50 && !prompts.join("\n").includes("This is the task"); i++)
      await Bun.sleep(50);
    expect(prompts.join("\n")).toContain("This is the task “Write the launch email”");
    await Bun.sleep(200);

    // Replace who works on it.
    await say(
      [
        `\`\`\`zetta:project\n${JSON.stringify({ action: "members", project: name, bots: [`Worker ${tag}`], people: [] })}\n\`\`\``,
      ],
      "only the bot",
    );
    await approve(A, (await pending(A))[0]!.id);
    expect((await projects.get(actor, made.id)).people).toEqual([]);

    // B read this project as a person once: B's chief may read it, and may not change it.
    await say(
      [
        `\`\`\`zetta:project\n${JSON.stringify({ action: "members", project: name, bots: [], people: [B] })}\n\`\`\``,
      ],
      "add B back",
    );
    await approve(A, (await pending(A))[0]!.id);
    const other = await chiefOf(B);
    prompts.length = 0;
    await other.say([`\`\`\`zetta:project\n{"action":"list"}\n\`\`\``], "what projects do I have");
    expect(prompts.join("\n")).toContain(name);
    prompts.length = 0;
    await other.say(
      [
        `\`\`\`zetta:project\n${JSON.stringify({ action: "update", project: name, status: "done" })}\n\`\`\``,
      ],
      "close it",
    );
    expect(prompts.join("\n")).toContain("only its owner changes it");
    expect(await pending(B)).toEqual([]);
  });

  test("the chief reads how a bot did and its saved versions, and bringing one back is a card that applies as a new version", async () => {
    const made = (await call(A, "POST", "/api/bots", { name: `Versioned ${uuidv7().slice(-6)}` }))
      .json.bot as { id: string; name: string; version: number };
    const v2 = (
      await call(A, "PATCH", `/api/bots/${made.id}`, {
        expectedVersion: made.version,
        patch: { harness: "codex", instructions: "First wording." },
      })
    ).json.bot as { version: number };
    const v3 = (
      await call(A, "PATCH", `/api/bots/${made.id}`, {
        expectedVersion: v2.version,
        patch: { instructions: "Second wording." },
      })
    ).json.bot as { version: number };
    const { say } = await chiefOf(A);

    prompts.length = 0;
    await say(
      [`\`\`\`zetta:bot\n${JSON.stringify({ action: "history", bot: made.name })}\n\`\`\``],
      "show its versions",
    );
    const seen = prompts.join("\n");
    expect(seen).toContain("bot.history:");
    expect(seen).toContain(`"version":${v3.version},"current":true`);

    prompts.length = 0;
    await say(
      [`\`\`\`zetta:bot\n${JSON.stringify({ action: "stats", bot: made.name, days: 30 })}\n\`\`\``],
      "how is it doing",
    );
    expect(prompts.join("\n")).toContain('"days":30');

    // Asking for the version it already has, or one that does not exist, never becomes a card.
    prompts.length = 0;
    await say(
      [
        `\`\`\`zetta:bot\n${JSON.stringify({ action: "restore", bot: made.name, version: v3.version })}\n\`\`\``,
      ],
      "restore the current one",
    );
    expect(prompts.join("\n")).toContain("is what");
    await say(
      [
        `\`\`\`zetta:bot\n${JSON.stringify({ action: "restore", bot: made.name, version: 99 })}\n\`\`\``,
      ],
      "restore 99",
    );
    expect(await pending(A)).toEqual([]);

    await say(
      [
        `\`\`\`zetta:bot\n${JSON.stringify({ action: "restore", bot: made.name, version: v2.version })}\n\`\`\``,
      ],
      "go back to the first wording",
    );
    const [card] = await pending(A);
    expect(card!.diff.map((d) => [d.field, d.to])).toEqual([["instructions", "First wording."]]);
    expect(
      (
        (await call(A, "GET", "/api/bots")).json.bots as { id: string; instructions: string }[]
      ).find((b) => b.id === made.id)!.instructions,
    ).toBe("Second wording.");
    expect((await approve(A, card!.id)).json.status).toBe("approved");
    const after = (
      (await call(A, "GET", "/api/bots")).json.bots as {
        id: string;
        instructions: string;
        version: number;
      }[]
    ).find((b) => b.id === made.id)!;
    expect(after).toMatchObject({ instructions: "First wording.", version: v3.version + 1 });
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

  test("a change asked for after the chief read outside text waits for a card, nothing is lost", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        '```zetta:memory\n{"action":"search","query":"digest"}\n```',
        '```zetta:routine\n{"action":"remove","routine":"Morning digest"}\n```',
      ],
      "look it up and delete the digest",
    );
    expect(prompts.join("\n")).not.toContain("are ignored");
    const cards = await pending(A);
    expect(cards.map((p) => p.kind)).toEqual(["chief_action"]);
    // User A is shared by the whole suite: decline the card so later tests start without pending cards.
    await call(A, "POST", `/api/proposals/${cards[0]!.id}/decision`, { approve: false });
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

  test("a form card the model writes itself is never shown", async () => {
    const { say } = await chiefOf(A);
    const reply = await say(
      [
        'Here you go.\n```zetta:form-card\n{"form":"source_login","botId":"x","botName":"Scout","prefill":{}}\n```',
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

  test("the chief manages the whole library: a long skill, read, rename, give, take away, delete, bring back", async () => {
    const { say } = await chiefOf(A);
    const decideAll = async () => {
      const cards = await pending(A);
      for (const p of cards) await approve(A, p.id);
      return cards;
    };
    const long = "Step by step. ".repeat(3000);
    await say(
      [
        '```zetta:create_bot\n{"name":"Skiller","personality":"tester"}\n```',
        `\`\`\`zetta:skill_library\n${JSON.stringify({ action: "create", name: "long-playbook", description: "A long one", body: long })}\n\`\`\``,
      ],
      "make a long skill",
    );
    expect((await pending(A)).map((p) => p.patch.title)).toEqual(["New skill long-playbook"]);
    await decideAll();
    // Read it back: the text reaches the bot, framed as data.
    prompts.length = 0;
    await say(
      ['```zetta:skill_library\n{"action":"read","skill":"long-playbook"}\n```', "Read it."],
      "show me the playbook",
    );
    expect(prompts.join("\n")).toContain("Step by step.");
    expect(prompts.join("\n")).toContain("UNTRUSTED EXTERNAL CONTENT");
    // A rename is a card with the old and the new name; a taken name is refused at once.
    await say(
      [
        '```zetta:skill_library\n{"action":"update","skill":"long-playbook","name":"main-playbook"}\n```',
      ],
      "rename it",
    );
    const [rename] = await pending(A);
    expect(rename!.diff.map((d) => d.field)).toEqual(["skill", "name"]);
    await approve(A, rename!.id);
    // Give it to a bot and take it away again.
    await say(
      [
        '```zetta:skill_library\n{"action":"attach","skill":"main-playbook","bots":["Skiller"]}\n```',
      ],
      "give it to Skiller",
    );
    await decideAll();
    const lib = createSkills(db);
    const me = (await actorOf(A))!;
    const botsOf = async () => (await lib.list(me)).find((x) => x.name === "main-playbook")!.botIds;
    expect(await botsOf()).toHaveLength(1);
    await say(
      [
        '```zetta:skill_library\n{"action":"detach","skill":"main-playbook","bots":["Skiller"]}\n```',
      ],
      "take it from Skiller",
    );
    const [detach] = await pending(A);
    expect(detach!.patch.title).toBe("Take skill main-playbook from Skiller");
    await approve(A, detach!.id);
    expect(await botsOf()).toHaveLength(0);
    // Delete it, then bring it back.
    await say(
      ['```zetta:skill_library\n{"action":"archive","skill":"main-playbook"}\n```'],
      "delete it",
    );
    await decideAll();
    expect((await lib.list(me)).some((x) => x.name === "main-playbook")).toBe(false);
    await say(
      ['```zetta:skill_library\n{"action":"restore","skill":"main-playbook"}\n```'],
      "bring it back",
    );
    const [restore] = await pending(A);
    expect(restore!.patch.title).toBe("Bring back skill main-playbook");
    await approve(A, restore!.id);
    expect((await lib.list(me)).some((x) => x.name === "main-playbook")).toBe(true);
  });

  test("a body over the library limit and a rename to a taken name are refused", async () => {
    const { say } = await chiefOf(A);
    prompts.length = 0;
    await say(
      [
        `\`\`\`zetta:skill_library\n${JSON.stringify({ action: "create", name: "too-long", description: "d", body: "x ".repeat(33_000) })}\n\`\`\``,
        "Done.",
      ],
      "make a huge skill",
    );
    expect(await pending(A)).toEqual([]);
    await say(
      [
        '```zetta:skill_library\n{"action":"create","name":"other-skill","description":"d","body":"b"}\n```',
      ],
      "another",
    );
    await approve(A, (await pending(A))[0]!.id);
    prompts.length = 0;
    await say(
      [
        '```zetta:skill_library\n{"action":"update","skill":"other-skill","name":"main-playbook"}\n```',
        "Done.",
      ],
      "rename it to a taken name",
    );
    expect(await pending(A)).toEqual([]);
    expect(prompts.join("\n")).toContain('a skill called "main-playbook" already exists');
  });
});

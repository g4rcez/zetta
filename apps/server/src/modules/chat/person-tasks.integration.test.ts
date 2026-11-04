import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { team } from "@zetta/db/schema/teams";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createDecisionService } from "../decisions/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createTaskStore, type PersonTaskEvent } from "../tasks/store";
import { createTeamPeople } from "../teams/people";
import { createLoopStore } from "./loops";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
// A owns the bots and the team, B is a stranger, C is a member of A's team.
const ids = [`ptask-a-${uuidv7()}`, `ptask-b-${uuidv7()}`, `ptask-c-${uuidv7()}`];
const [A, B, C] = ids as [string, string, string];

suite("a bot that needs a person assigns them a task", () => {
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
  // Laya is the only fake: it answers with `odds` and keeps what it was asked. The decision service around it is the real one.
  let odds: { finished: number; moved_along: number } | "error" = {
    finished: 0.5,
    moved_along: 0.5,
  };
  const asked: string[] = [];
  const laya = createDecisionService(
    async () => ({
      close: async () => {},
      systemOne: async (subject: never) => {
        asked.push(String(subject));
        if (odds === "error") throw new Error("boom");
        const choice = odds.finished >= odds.moved_along ? "finished" : "moved_along";
        return { answers: { pick: { type: "choice", choice, probabilities: odds } } } as never;
      },
    }),
    30_000,
    { mode: "on" },
  );
  const tasks = createTaskStore(db);
  const loops = createLoopStore(db);
  const people = createTeamPeople(db);
  const events: PersonTaskEvent[] = [];
  const chatSvc = createChatService(
    db,
    fakeRun as never,
    undefined,
    undefined,
    laya,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      tasks,
      loops,
      backgroundActor: (userId: string) =>
        issueBackgroundActor(async () => ({ isAdmin: false }) as never, userId),
    },
  );
  // Same wiring as services.ts: a person's move tells the bot that asked.
  tasks.onPersonTask = (e) => {
    events.push(e);
    void chatSvc.notifyTask(e).catch(() => {});
  };
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: chatSvc },
    tasks: { access, tasks },
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
  let teamId = "";
  // Each test starts with a Laya that cannot tell: the bot runs unless the test says otherwise.
  beforeEach(() => {
    odds = { finished: 0.5, moved_along: 0.5 };
  });
  beforeAll(async () => {
    await laya.warm();
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
    const [made] = await db
      .insert(team)
      .values({ ownerUserId: A, name: `Crew ${A}` })
      .returning();
    teamId = made!.id;
    await people.add(teamId, C);
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  type Task = {
    id: string;
    title: string;
    description: string;
    status: string;
    assignee: string;
    assigneeUserId: string | null;
    botId: string | null;
    conversationId: string | null;
  };
  const tasksOf = async (as: string) => (await call(as, "GET", "/api/tasks")).json.tasks as Task[];
  const cardOf = async (userId: string, taskId: string) =>
    (
      await db
        .select()
        .from(attentionItem)
        .where(
          and(eq(attentionItem.ownerUserId, userId), eq(attentionItem.sourceKey, `task:${taskId}`)),
        )
    )[0];
  const setup = async (as: string, name: string) => {
    const bot = (await call(as, "POST", "/api/bots", { name })).json.bot as { id: string };
    await db.$client.query(
      "update bot set onboarded = true, computer_mode = 'browser' where id = $1",
      [bot.id],
    );
    const c = (await call(as, "POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    return {
      bot,
      c,
      say: async (reply: string) => {
        script = [reply];
        await call(as, "POST", `/api/conversations/${c}/messages`, { content: "go" });
      },
    };
  };

  test("a bot adds a task assigned to the user and the user gets a card for it", async () => {
    const { bot, c, say } = await setup(A, "Planner");
    await say(
      '```zetta:task\n{"action":"add","title":"Send me the CRM export","description":"I cannot reach the CRM","assignee":"user"}\n```',
    );
    const task = (await tasksOf(A)).find((t) => t.title === "Send me the CRM export")!;
    expect(task).toMatchObject({
      assignee: "person",
      assigneeUserId: A,
      botId: bot.id,
      conversationId: c,
      description: "I cannot reach the CRM",
      status: "backlog",
    });
    const card = await cardOf(A, task.id);
    expect(card).toMatchObject({ status: "open", resultLink: `/tasks/${task.id}`, source: "bot" });
  });

  test("a task for a person the user does not share a team with is not created", async () => {
    const { say } = await setup(A, "Stranger asker");
    await say(
      `\`\`\`zetta:task\n{"action":"add","title":"Ask a stranger","assignee":"${B}"}\n\`\`\``,
    );
    expect((await tasksOf(A)).some((t) => t.title === "Ask a stranger")).toBe(false);
    expect((await tasksOf(B)).some((t) => t.title === "Ask a stranger")).toBe(false);
  });

  test("a task without an assignee stays a plain task of the bot", async () => {
    const { bot, say } = await setup(A, "Plain adder");
    await say('```zetta:task\n{"action":"add","title":"Tidy the wiki"}\n```');
    expect((await tasksOf(A)).find((t) => t.title === "Tidy the wiki")).toMatchObject({
      assignee: "bot",
      assigneeUserId: null,
      botId: bot.id,
    });
  });

  test("a hand-off becomes one task for the user, and handing off again does not add another", async () => {
    const { bot, c, say } = await setup(A, "Surfer");
    await say('```zetta:handoff\n{"reason":"Please sign in"}\n```');
    await say('```zetta:handoff\n{"reason":"Please sign in"}\n```');
    const mine = (await tasksOf(A)).filter(
      (t) => t.title === "Surfer needs you to take over the browser",
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      assignee: "person",
      assigneeUserId: A,
      botId: bot.id,
      conversationId: c,
      description: "Please sign in",
    });
    expect((await cardOf(A, mine[0]!.id))?.nextAction).toContain("hand it back");
  });

  test("a reply that calls @user becomes one task for the user", async () => {
    const { bot, say } = await setup(A, "Caller");
    await say("I am stuck on the invoice.\n\n@user which account should I use?");
    await say("Still waiting.\n\n@user which account should I use?");
    const mine = (await tasksOf(A)).filter((t) => t.title === "Caller needs you");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ assignee: "person", assigneeUserId: A, botId: bot.id });
    expect(mine[0]!.description).toContain("which account should I use?");
  });

  const waitFor = async (check: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await Bun.sleep(50);
    }
    throw new Error("timed out");
  };
  /** The quiet labels the server saved in a chat when it woke the bot. */
  const notices = async (c: string) =>
    (
      await db.$client.query(
        "select content from message where conversation_id = $1 and role = 'system' order by created_at",
        [c],
      )
    ).rows.map((r) => r.content as string);
  /** Finished bot answers in a chat: a woken bot is done when its answer is saved. */
  const answers = async (c: string) =>
    Number(
      (
        await db.$client.query(
          "select count(*)::int as n from message where conversation_id = $1 and role = 'assistant' and status = 'complete'",
          [c],
        )
      ).rows[0].n,
    );
  test("finishing the task closes the card", async () => {
    const { c, say } = await setup(A, "Closer");
    await say(
      '```zetta:task\n{"action":"add","title":"Approve the budget","assignee":"user"}\n```',
    );
    const task = (await tasksOf(A)).find((t) => t.title === "Approve the budget")!;
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "done" });
    expect((await cardOf(A, task.id))?.status).toBe("resolved");
    // The bot is woken by the move: let that turn end, so it does not use the next test's scripted replies.
    await waitFor(async () => (await answers(c)) === 2);
  });

  const asks = async (as: string, name: string, title: string) => {
    const t = await setup(as, name);
    await t.say(`\`\`\`zetta:task\n{"action":"add","title":"${title}","assignee":"user"}\n\`\`\``);
    const task = (await tasksOf(as)).find((x) => x.title === title)!;
    return { ...t, task };
  };

  test("when the person marks the task done, the bot that asked is woken and told what changed", async () => {
    const { c, task } = await asks(A, "Waiter", "Pay the invoice");
    script = ["Thanks, I carry on."];
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "done" });
    await waitFor(async () => (await answers(c)) === 2);
    expect(await notices(c)).toEqual([`${A} moved “Pay the invoice” to Done`]);
    expect(prompts.some((p) => p.includes("moved the task “Pay the invoice” to Done"))).toBe(true);
  });

  test("a move to another status wakes the bot too", async () => {
    const { c, task } = await asks(A, "Progress waiter", "Read the contract");
    script = ["Good, I wait."];
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "in_progress" });
    await waitFor(async () => (await answers(c)) === 2);
    expect(await notices(c)).toEqual([`${A} moved “Read the contract” to In progress`]);
  });

  test("deleting the task tells the bot it no longer waits", async () => {
    const { c, task } = await asks(A, "Delete waiter", "Cancel the trip");
    script = ["Understood, I go on without it."];
    await call(A, "DELETE", `/api/tasks/${task.id}`);
    await waitFor(async () => (await answers(c)) === 2);
    expect(await notices(c)).toEqual([`${A} deleted “Cancel the trip”`]);
    expect(prompts.some((p) => p.includes("deleted the task “Cancel the trip”"))).toBe(true);
  });

  test("a bot that moves its own task does not wake itself", async () => {
    const { c, task, say } = await asks(A, "Self mover", "Move myself");
    await say(`\`\`\`zetta:task\n{"action":"update","id":"${task.id}","status":"done"}\n\`\`\``);
    await Bun.sleep(300);
    expect((await tasksOf(A)).find((t) => t.id === task.id)?.status).toBe("done");
    expect(await notices(c)).toEqual([]);
  });

  test("a team member who marks the task done wakes the bot in the owner's chat", async () => {
    const { bot, c } = await setup(A, "Member waiter");
    const owner = (await issueBackgroundActor(async () => ({ isAdmin: false }) as never, A))!;
    const asked = await tasks.ask(owner, {
      title: "Review the contract",
      assigneeUserId: C,
      teamId,
      botId: bot.id,
      conversationId: c,
    });
    script = ["Thanks."];
    await call(C, "PATCH", `/api/tasks/${asked.id}`, { status: "done" });
    await waitFor(async () => (await answers(c)) === 1);
    expect(await notices(c)).toEqual([`${C} moved “Review the contract” to Done`]);
  });

  test("a loop that paused for the person resumes when they finish, without a second turn", async () => {
    const { bot, c, task } = await asks(A, "Loop waiter", "Connect the account");
    const loop = await loops.start(A, {
      conversationId: c,
      botId: bot.id,
      goal: "Collect the report",
      doneWhen: "The report is saved",
    });
    await loops.pause(loop.id, "waiting for you: connect the account", true);
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "done" });
    await waitFor(async () => (await loops.get(loop.id))?.status === "running");
    expect((await loops.get(loop.id))?.progress).toContain(
      `The person you waited for acted: ${A} moved the task “Connect the account” to Done`,
    );
    expect(await notices(c)).toEqual([]);
  });

  test("a loop paused for another reason is left alone and the bot is woken", async () => {
    const { bot, c, task } = await asks(A, "Stalled waiter", "Share the file");
    const loop = await loops.start(A, {
      conversationId: c,
      botId: bot.id,
      goal: "Collect the report",
      doneWhen: "The report is saved",
    });
    await loops.pause(loop.id, "no new progress in the last 5 steps", true);
    script = ["Noted."];
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "done" });
    await waitFor(async () => (await answers(c)) === 2);
    expect((await loops.get(loop.id))?.status).toBe("paused");
  });

  test("when Laya is sure the person only moved the task along, the bot gets a note and no turn", async () => {
    const { c, say } = await setup(A, "Note waiter");
    await say(
      'I need the budget approved.\n```zetta:task\n{"action":"add","title":"Approve the Q4 budget","assignee":"user"}\n```',
    );
    const task = (await tasksOf(A)).find((t) => t.title === "Approve the Q4 budget")!;
    odds = { finished: 0.05, moved_along: 0.95 };
    asked.length = 0;
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "in_progress" });
    await waitFor(async () => (await notices(c)).length === 1);
    await Bun.sleep(300);
    expect(await notices(c)).toEqual([`${A} moved “Approve the Q4 budget” to In progress`]);
    expect(await answers(c)).toBe(1);
    expect(prompts.some((p) => p.includes("moved the task “Approve the Q4 budget”"))).toBe(false);
  });

  test("Laya is given the task, what the bot said and what the person did", async () => {
    const { c, say } = await setup(A, "Context waiter");
    await say(
      'I need the contract signed.\n```zetta:task\n{"action":"add","title":"Sign the supplier contract","description":"Two pages, by Friday","assignee":"user"}\n```',
    );
    const task = (await tasksOf(A)).find((t) => t.title === "Sign the supplier contract")!;
    odds = { finished: 0.05, moved_along: 0.95 };
    asked.length = 0;
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "review" });
    await waitFor(async () => (await notices(c)).length === 1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Sign the supplier contract");
    expect(asked[0]).toContain("Two pages, by Friday");
    expect(asked[0]).toContain("I need the contract signed.");
    expect(asked[0]).not.toContain("zetta:task");
    expect(asked[0]).toContain("moved the task to Review");
  });

  test("when Laya is sure the person finished, or is unsure, or fails, the bot runs", async () => {
    for (const [title, answer] of [
      ["Laya says finished", { finished: 0.95, moved_along: 0.05 }],
      ["Laya is unsure", { finished: 0.4, moved_along: 0.6 }],
      ["Laya fails", "error"],
    ] as const) {
      const { c, task } = await asks(A, `Runner ${title}`, title);
      odds = answer;
      script = ["Understood."];
      await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "in_progress" });
      await waitFor(async () => (await answers(c)) === 2);
      expect(await notices(c)).toEqual([`${A} moved “${title}” to In progress`]);
    }
  });

  test("a note is saved once however often the change is delivered", async () => {
    const { c, task } = await asks(A, "Twice note waiter", "Sign the NDA");
    odds = { finished: 0.05, moved_along: 0.95 };
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "review" });
    await waitFor(async () => (await notices(c)).length === 1);
    await chatSvc.notifyTask(events.filter((e) => e.task.id === task.id).at(-1)!);
    expect(await notices(c)).toEqual([`${A} moved “Sign the NDA” to Review`]);
  });

  test("the same change delivered twice runs one turn", async () => {
    const { c, task } = await asks(A, "Twice waiter", "Sign the form");
    script = ["Done, thanks."];
    await call(A, "PATCH", `/api/tasks/${task.id}`, { status: "done" });
    await waitFor(async () => (await answers(c)) === 2);
    await chatSvc.notifyTask(events.filter((e) => e.task.id === task.id).at(-1)!);
    expect(await notices(c)).toEqual([`${A} moved “Sign the form” to Done`]);
    expect(await answers(c)).toBe(2);
  });
});

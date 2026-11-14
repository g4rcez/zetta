import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createTaskStore } from "../tasks/store";
import { attentionItem, configProposal } from "@zetta/db/schema/features";
import { and, eq } from "@zetta/db/query";
import { QUIET_MS } from "../tasks/follow-up";
import { createLoopStore } from "./loops";
import { createTaskHeartbeat, type FollowedTask } from "./task-heartbeat";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `tplan-a-${uuidv7()}`;

type Reply = string | (() => string | Promise<string>);

suite("a bot plans its work as a task with subtasks", () => {
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
  let script: Reply[] = [];
  const prompts: string[] = [];
  const next = async () => {
    const r = script.shift();
    return typeof r === "function" ? await r() : (r ?? "done");
  };
  const fakeRun = Object.assign(
    async (t: { prompt: string }) => {
      prompts.push(t.prompt);
      return { text: await next(), stopped: false };
    },
    {
      stream: async function* (t: { prompt: string }) {
        prompts.push(t.prompt);
        yield await next();
      },
    },
  );
  // The done check: a test sets the verdict it wants.
  let verdict = '{"met":true,"reason":""}';
  const checked: string[] = [];
  const checkCli = (async (t: { prompt: string }) => {
    checked.push(t.prompt);
    return verdict;
  }) as never;
  const tasks = createTaskStore(db);
  const loops = createLoopStore(db);
  const chatSvc = createChatService(
    db,
    fakeRun as never,
    undefined,
    undefined,
    undefined,
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
      checkCli,
      backgroundActor: (userId: string) =>
        issueBackgroundActor(async () => ({ isAdmin: false }) as never, userId),
    },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: chatSvc },
    tasks: { access, tasks },
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
  type Row = {
    id: string;
    title: string;
    status: string;
    followUp: string;
    progress: string;
    parentTaskId: string | null;
    nextCheckAt: string | null;
    messageId: string | null;
    botId: string | null;
    conversationId: string | null;
  };
  const board = async () => (await call("GET", "/api/tasks")).json.tasks as Row[];
  const fence = (kind: string, body: unknown) =>
    `\`\`\`zetta:${kind}\n${JSON.stringify(body)}\n\`\`\``;
  /** A reply built when the bot is called: it finds the task and its steps by title, like a bot reading its ids. */
  const stepsOf = async (title: string) => {
    const rows = await board();
    const parent = rows.find((t) => t.title === title && !t.parentTaskId)!;
    // The board lists the newest change first; the plan keeps its creation order (UUID v7 ids grow).
    return {
      parent,
      steps: rows
        .filter((t) => t.parentTaskId === parent.id)
        .sort((x, y) => (x.id < y.id ? -1 : 1)),
    };
  };
  let n = 0;
  const setup = async () => {
    const bot = (await call("POST", "/api/bots", { name: `Planner ${++n}` })).json.bot as {
      id: string;
    };
    await db.$client.query(
      "update bot set onboarded = true, computer_mode = 'browser', harness = 'claude-code' where id = $1",
      [bot.id],
    );
    const c = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    return {
      bot,
      c,
      say: async (content: string, ...replies: Reply[]) => {
        script = replies;
        prompts.length = 0;
        await call("POST", `/api/conversations/${c}/messages`, { content });
      },
    };
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
    await cleanupTestUsers(db, [A]);
  });

  test("a plan becomes a followed task with steps, and the bot gets the step ids back to keep working", async () => {
    const { bot, c, say } = await setup();
    await say(
      "Prepare the launch notes",
      fence("task", {
        action: "add",
        title: "Launch notes",
        subtasks: ["Collect changes", "Write notes", "Proofread"],
      }),
      "Starting with the first step.",
    );
    const { parent, steps } = await stepsOf("Launch notes");
    expect(parent).toMatchObject({
      followUp: "auto",
      status: "backlog",
      botId: bot.id,
      conversationId: c,
    });
    expect(parent.nextCheckAt).not.toBeNull();
    expect(parent.messageId).not.toBeNull();
    expect(steps.map((s) => s.title)).toEqual(["Collect changes", "Write notes", "Proofread"]);
    expect(steps.every((s) => s.followUp === "off")).toBe(true);
    // the second call to the bot carries the ids of the steps
    expect(prompts).toHaveLength(2);
    for (const s of steps) expect(prompts[1]).toContain(s.id);
    expect(prompts[1]).toContain("task.add ok");
  });

  test("moving steps and writing progress applies at once, without a card", async () => {
    const { say } = await setup();
    await say(
      "Write the report",
      fence("task", { action: "add", title: "Report", subtasks: ["Outline", "Draft"] }),
      async () => {
        const { parent, steps } = await stepsOf("Report");
        return [
          fence("task", { action: "update", id: steps[0]!.id, status: "done" }),
          fence("task", {
            action: "update",
            id: parent.id,
            status: "in_progress",
            progress: "Outline done; draft is next.",
          }),
        ].join("\n");
      },
      "The outline is done.",
    );
    const { parent, steps } = await stepsOf("Report");
    expect(steps.map((s) => s.status)).toEqual(["done", "backlog"]);
    expect(parent).toMatchObject({
      status: "in_progress",
      progress: "Outline done; draft is next.",
    });
  });

  const pendingCards = async () =>
    Number(
      (
        await db.$client.query(
          "select count(*)::int as n from config_proposal where owner_user_id = $1 and kind = 'bot_action' and status = 'pending'",
          [A],
        )
      ).rows[0].n,
    );
  test("after outside content a bot still adds and moves its own tasks at once, without a card", async () => {
    const { say } = await setup();
    const before = await pendingCards();
    await say(
      "Plan after reading the board",
      // task list returns text other people wrote: the turn is tainted from here on
      fence("task", { action: "list" }),
      fence("task", { action: "add", title: "Tainted plan", subtasks: ["First", "Second"] }),
      async () => {
        const { parent, steps } = await stepsOf("Tainted plan");
        return [
          fence("task", { action: "update", id: steps[0]!.id, status: "done" }),
          fence("task", { action: "update", id: parent.id, status: "in_progress" }),
          fence("task", { action: "add", title: "Extra step", parentId: parent.id }),
        ].join("\n");
      },
      "Moved.",
    );
    const { parent, steps } = await stepsOf("Tainted plan");
    expect(parent.status).toBe("in_progress");
    expect(steps.map((s) => s.title)).toEqual(["First", "Second", "Extra step"]);
    expect(steps[0]!.status).toBe("done");
    expect(await pendingCards()).toBe(before);
  });

  test("after outside content a bot also moves a task it does not own at once, without a card", async () => {
    const { say } = await setup();
    const made = await call("POST", "/api/tasks", { title: "Made on the board" });
    const boardId = made.json.task.id as string;
    const before = await pendingCards();
    await say(
      "Touch the board task",
      fence("task", { action: "list" }),
      fence("task", { action: "update", id: boardId, status: "done" }),
      "Done.",
    );
    const row = (await board()).find((t) => t.id === boardId)!;
    expect(row.status).toBe("done");
    expect(await pendingCards()).toBe(before);
  });

  test("a card raised before tasks stopped waiting still runs its task call when it is approved", async () => {
    const { bot, c } = await setup();
    const made = await call("POST", "/api/tasks", { title: "Held by an old card" });
    const boardId = made.json.task.id as string;
    const [card] = await db
      .insert(configProposal)
      .values({
        ownerUserId: A,
        botId: bot.id,
        proposedByBotId: bot.id,
        kind: "bot_action",
        baseVersion: 0,
        patch: {
          botId: bot.id,
          conversationId: c,
          scope: { policy: "default" },
          calls: [{ kind: "task", args: { action: "update", id: boardId, status: "done" } }],
        },
        diff: [{ field: "task", from: null, to: "task update" }],
      })
      .returning();
    const decided = await call("POST", `/api/proposals/${card!.id}/decision`, { approve: true });
    expect(decided.json).toMatchObject({ status: "approved" });
    expect((await board()).find((t) => t.id === boardId)!.status).toBe("done");
  });

  test("a task with an open step cannot be closed, and the bot is told which", async () => {
    const { say } = await setup();
    await say(
      "Ship the fix",
      fence("task", { action: "add", title: "Fix", subtasks: ["Patch", "Test"] }),
      async () => {
        const { parent } = await stepsOf("Fix");
        return fence("task", { action: "update", id: parent.id, status: "done" });
      },
      "Understood, the test step is still open.",
    );
    const { parent } = await stepsOf("Fix");
    expect(parent.status).toBe("backlog");
    expect(prompts.join("\n")).toContain("Subtasks still open");
    expect(prompts.join("\n")).toContain("“Patch”");
  });

  const closeAll = (title: string) => async () => {
    const { parent, steps } = await stepsOf(title);
    return [
      ...steps.map((s) => fence("task", { action: "update", id: s.id, status: "done" })),
      fence("task", {
        action: "update",
        id: parent.id,
        status: "done",
        progress: "Everything is written.",
      }),
    ].join("\n");
  };
  test("a followed task is not closed when the done check says something is missing", async () => {
    const { say } = await setup();
    checked.length = 0;
    verdict = '{"met":false,"reason":"the summary is missing"}';
    await say(
      "Write a summary",
      fence("task", { action: "add", title: "Summary", subtasks: ["Write it"] }),
      closeAll("Summary"),
      "I will add the summary.",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain("Write a summary");
    const { parent } = await stepsOf("Summary");
    expect(parent.status).toBe("in_progress");
    expect(parent.followUp).toBe("auto");
    expect(prompts.join("\n")).toContain("refused by the done check: the summary is missing");
  });
  test("a followed task is closed, and no longer followed, when the done check agrees", async () => {
    const { say } = await setup();
    verdict = '{"met":true,"reason":""}';
    await say(
      "Write a second summary",
      fence("task", { action: "add", title: "Second summary", subtasks: ["Write it"] }),
      closeAll("Second summary"),
      "All done.",
    );
    const { parent, steps } = await stepsOf("Second summary");
    expect(steps.map((s) => s.status)).toEqual(["done"]);
    expect(parent).toMatchObject({ status: "done", followUp: "off", nextCheckAt: null });
  });

  test("a step can be added later, but a step of a step is refused", async () => {
    const { say } = await setup();
    await say(
      "Plan the trip",
      fence("task", { action: "add", title: "Trip", subtasks: ["Book"] }),
      async () => {
        const { parent, steps } = await stepsOf("Trip");
        return [
          fence("task", { action: "add", title: "Pack", parentId: parent.id }),
          fence("task", { action: "add", title: "Deeper", parentId: steps[0]!.id }),
        ].join("\n");
      },
      "Done planning.",
    );
    const { parent, steps } = await stepsOf("Trip");
    expect(steps.map((s) => s.title)).toEqual(["Book", "Pack"]);
    expect(parent.followUp).toBe("auto");
    expect(prompts.join("\n")).toContain("A subtask cannot have subtasks");
  });

  test("a bot can stop the follow-up with a reason and schedule its own next look", async () => {
    const { say } = await setup();
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
    await say(
      "Watch the deploy",
      fence("task", { action: "add", title: "Deploy", subtasks: ["Watch it"] }),
      async () => {
        const { parent } = await stepsOf("Deploy");
        return fence("task", {
          action: "update",
          id: parent.id,
          progress: "Deploy started; waiting for it.",
          checkAt: inAnHour,
        });
      },
      "Waiting.",
    );
    const { parent } = await stepsOf("Deploy");
    expect(parent.followUp).toBe("auto");
    expect(Math.abs(+new Date(parent.nextCheckAt!) - +new Date(inAnHour))).toBeLessThan(1000);
  });

  test("at the step limit a bot with a followed task is told to save its place, not to give up", async () => {
    const { say } = await setup();
    // Twelve rounds, each adding a new followed task so the results differ (the same result three times would stop the turn first).
    const rounds = Array.from({ length: 12 }, (_, i) =>
      fence("task", { action: "add", title: `Part ${i}`, subtasks: ["Do it"] }),
    );
    await say("Do a lot of work", ...rounds, "Saved.");
    const last = prompts.at(-1)!;
    expect(last).toContain("save where you are with zetta:task");
    expect(last).toContain("You will be called back to continue");
    expect(last).not.toContain("end with a zetta:goal block");
  });
  test("at the step limit a bot with no task is told to add one for what is left", async () => {
    const { say } = await setup();
    const rounds = Array.from({ length: 12 }, (_, i) =>
      [
        fence("task", { action: "add", title: `Ask ${i}`, assignee: "user" }),
        fence("task", { action: "list" }),
      ].join("\n"),
    );
    await say("Do a lot of work", ...rounds, "Here is what is left.");
    const last = prompts.at(-1)!;
    expect(last).toContain("add one zetta:task with a step for each part that is left");
    expect(last).toContain("zetta:goal block");
  });

  // ---- The heartbeat: a fake turn stands in for the bot; the store, the cards and the lease are real. ----
  describe("the heartbeat keeps a followed task going", () => {
    type Turn = { status: string; error?: string };
    let turns: { task: FollowedTask; label: string; prompt: string }[] = [];
    let behave: (t: FollowedTask) => Promise<Turn> | Turn = () => ({ status: "complete" });
    let busy = false;
    let paused = false;
    const heart = createTaskHeartbeat({
      db,
      tasks,
      runTurn: async (task, label, prompt) => {
        turns.push({ task, label, prompt });
        return behave(task);
      },
      requestOf: async () => "Please finish the quarterly report",
      ownerPaused: async () => paused,
      covered: async () => busy,
    });
    const actor = () => issueBackgroundActor(async () => ({ isAdmin: false }) as never, A);
    const made = async (title: string, steps: string[] = ["One", "Two"]) => {
      const { bot, c } = await setup();
      const { task } = await tasks.createWithSubtasks(
        (await actor())!,
        { title, followUp: "auto", nextCheckAt: new Date(Date.now() - 1000) },
        steps,
        { botId: bot.id, conversationId: c },
      );
      return task;
    };
    const fresh = async (id: string) => (await tasks.plan(id))!;
    const cardOf = async (id: string) =>
      (
        await db
          .select()
          .from(attentionItem)
          .where(
            and(eq(attentionItem.ownerUserId, A), eq(attentionItem.sourceKey, `task-follow:${id}`)),
          )
      )[0];
    const reset = () => {
      turns = [];
      behave = () => ({ status: "complete" });
      busy = false;
      paused = false;
    };
    /** What a bot does in a follow-up: the next open step is done. */
    const doesAStep = async (t: FollowedTask) => {
      const { steps } = await fresh(t.id);
      const open = steps.find((x) => x.status !== "done");
      if (open) await tasks.update((await actor())!, open.id, { status: "done" }, { by: "bot" });
      return { status: "complete" };
    };

    test("a due task gets a turn that carries its steps, its note and the request, and progress resets the stalls", async () => {
      reset();
      const t = await made("Quarterly report");
      await tasks.update((await actor())!, t.id, { progress: "Outline written." }, { by: "bot" });
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second', stalls = 2 where id = $1",
        [t.id],
      );
      behave = doesAStep;
      await heart.tickAndWait();
      expect(turns).toHaveLength(1);
      expect(turns[0]!.label).toContain("Continuing: Quarterly report");
      for (const needle of [
        "One",
        "Two",
        "Outline written.",
        "Please finish the quarterly report",
        "zetta:task",
      ])
        expect(turns[0]!.prompt).toContain(needle);
      const { task, steps } = await fresh(t.id);
      expect(steps.map((x) => x.status)).toEqual(["done", "backlog"]);
      expect(task).toMatchObject({ checks: 1, stalls: 0, failures: 0, followUp: "auto" });
      expect(+task.nextCheckAt! - Date.now()).toBeGreaterThan(QUIET_MS - 5_000);
      // not due again until the quiet time has passed
      await heart.tickAndWait();
      expect(turns).toHaveLength(1);
    });

    test("a check that records nothing counts as a stall, and the third one pauses the task and asks the user", async () => {
      reset();
      const t = await made("Silent bot");
      for (let i = 1; i <= 3; i++) {
        await db.$client.query(
          "update task set next_check_at = now() - interval '1 second' where id = $1",
          [t.id],
        );
        await heart.tickAndWait();
        const row = (await fresh(t.id)).task;
        if (i < 3) expect(row).toMatchObject({ followUp: "auto", stalls: i, checks: i });
      }
      const { task } = await fresh(t.id);
      expect(task).toMatchObject({ followUp: "paused", nextCheckAt: null });
      expect(task.followUpReason).toContain("no progress");
      expect(await cardOf(t.id)).toMatchObject({ status: "open", resultLink: `/tasks/${t.id}` });
      expect(turns[2]!.prompt).toContain("No change was recorded in the last 2 follow-ups");
      // resuming closes the card and starts the counters over
      await tasks.update((await actor())!, t.id, { followUp: "auto" });
      expect((await cardOf(t.id))?.status).toBe("resolved");
      expect((await fresh(t.id)).task).toMatchObject({ followUp: "auto", stalls: 0, checks: 0 });
    });

    test("a busy chat, a covered bot and paused agents are skipped without counting", async () => {
      reset();
      const t = await made("Not now");
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second' where id = $1",
        [t.id],
      );
      busy = true;
      await heart.tickAndWait();
      expect(turns).toHaveLength(0);
      let row = (await fresh(t.id)).task;
      expect(row.checks).toBe(0);
      expect(+row.nextCheckAt! - Date.now()).toBeGreaterThan(30_000);
      busy = false;
      paused = true;
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second' where id = $1",
        [t.id],
      );
      await heart.tickAndWait();
      expect(turns).toHaveLength(0);
      row = (await fresh(t.id)).task;
      expect(row).toMatchObject({ followUp: "auto", checks: 0 });
    });

    test("a failed turn waits and retries; a sign-in problem pauses the task", async () => {
      reset();
      const t = await made("Flaky");
      behave = () => ({ status: "failed" });
      await heart.tickAndWait();
      let row = (await fresh(t.id)).task;
      expect(row).toMatchObject({ followUp: "auto", failures: 1, checks: 1 });
      expect(row.followUpReason).toContain("Retrying");
      expect(+row.nextCheckAt! - Date.now()).toBeGreaterThan(20_000);
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second' where id = $1",
        [t.id],
      );
      behave = () => ({ status: "failed", error: "auth_required" });
      await heart.tickAndWait();
      row = (await fresh(t.id)).task;
      expect(row).toMatchObject({ followUp: "paused" });
      expect(row.followUpReason).toContain("not signed in");
      expect(await cardOf(t.id)).toBeDefined();
      // the retry prompt tells the bot its last follow-up did not run
      await tasks.update((await actor())!, t.id, { followUp: "auto" });
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second', follow_up_reason = 'Retrying: the usage limit is reached' where id = $1",
        [t.id],
      );
      behave = () => ({ status: "complete" });
      await heart.tickAndWait();
      expect(turns.at(-1)!.prompt).toContain("did not run");
    });

    test("pressing Stop pauses the task quietly, but pausing everything does not", async () => {
      reset();
      const t = await made("Stopped");
      behave = () => ({ status: "cancelled" });
      paused = false;
      await heart.tickAndWait();
      expect((await fresh(t.id)).task).toMatchObject({
        followUp: "paused",
        followUpReason: "stopped by you",
      });
      expect(await cardOf(t.id)).toBeUndefined();
      const u = await made("Paused everything");
      behave = async () => {
        paused = true;
        return { status: "cancelled" };
      };
      await heart.tickAndWait();
      expect((await fresh(u.id)).task).toMatchObject({ followUp: "auto" });
    });

    test("a time the bot chose is kept and is not a stall; a task the bot closed is left alone", async () => {
      reset();
      const t = await made("Waits for deploy");
      const later = new Date(Date.now() + 3_600_000);
      behave = async (x) => {
        await tasks.update((await actor())!, x.id, { nextCheckAt: later }, { by: "bot" });
        return { status: "complete" };
      };
      await heart.tickAndWait();
      let row = (await fresh(t.id)).task;
      expect(row).toMatchObject({ stalls: 0, checks: 1, followUp: "auto" });
      expect(Math.abs(+row.nextCheckAt! - +later)).toBeLessThan(1000);
      const u = await made("Closed in the turn", []);
      behave = async (x) => {
        await tasks.update((await actor())!, x.id, { status: "done" }, { by: "bot" });
        return { status: "complete" };
      };
      await heart.tickAndWait();
      row = (await fresh(u.id)).task;
      expect(row).toMatchObject({ status: "done", followUp: "off", checks: 0 });
    });

    test("a task at the cap is paused without a turn, and two ticks at once make one turn", async () => {
      reset();
      const t = await made("Endless");
      await db.$client.query(
        "update task set checks = 40, next_check_at = now() - interval '1 second' where id = $1",
        [t.id],
      );
      await heart.tickAndWait();
      expect(turns).toHaveLength(0);
      expect((await fresh(t.id)).task).toMatchObject({ followUp: "paused" });
      const u = await made("Twice");
      behave = async (x) => {
        await Bun.sleep(100);
        return doesAStep(x);
      };
      await Promise.all([heart.tickAndWait(), heart.tickAndWait()]);
      expect(turns.filter((x) => x.task.id === u.id)).toHaveLength(1);
    });

    const waitFor = async (check: () => boolean | Promise<boolean>) => {
      for (let i = 0; i < 100; i++) {
        if (await check()) return;
        await Bun.sleep(50);
      }
      throw new Error("timed out");
    };
    const followed = async (title: string) => {
      const { bot, c, say } = await setup();
      const { task } = await tasks.createWithSubtasks(
        (await actor())!,
        { title, followUp: "auto", nextCheckAt: new Date(Date.now() - 1000) },
        [],
        { botId: bot.id, conversationId: c },
      );
      return { task, c, say };
    };
    test("the real wiring: the follow-up is a quiet turn in the chat, the bot records its work, and the task finishes over several checks", async () => {
      reset();
      const real = createTaskHeartbeat({
        db,
        tasks,
        requestOf: (t) => tasks.requestOf(t),
        ownerPaused: async () => false,
        covered: async (t) => chatSvc.isBusy((await actor())!, t.conversationId!),
        runTurn: async (task, label, prompt, requestKey) => {
          const { follow } = await chatSvc.startTurn((await actor())!, task.conversationId!, {
            content: label,
            clientRequestId: requestKey,
            notice: { prompt },
          });
          let status = "failed";
          for await (const { event } of follow())
            if (event.type === "message") status = event.message.status;
          return { status };
        },
      });
      const { bot, c, say } = await setup();
      await say(
        "Write two notes",
        fence("task", { action: "add", title: "Two notes", subtasks: ["Note A", "Note B"] }),
        "Starting.",
      );
      const { parent } = await stepsOf("Two notes");
      // The chat is quiet now; the check comes due.
      const doStep = (which: number, progress: string) => async () => {
        const { parent: p, steps } = await stepsOf("Two notes");
        return [
          fence("task", { action: "update", id: steps[which]!.id, status: "done" }),
          fence("task", { action: "update", id: p.id, progress }),
        ].join("\n");
      };
      script = [doStep(0, "Note A written."), "Wrote note A."];
      prompts.length = 0;
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second' where id = $1",
        [parent.id],
      );
      await real.tickAndWait();
      expect(prompts[0]).toContain("follow-up 1 of 40");
      expect(prompts[0]).toContain("Note B");
      expect(prompts[0]).toContain("Write two notes");
      let now = await fresh(parent.id);
      expect(now.steps.map((x) => x.status)).toEqual(["done", "backlog"]);
      expect(now.task).toMatchObject({ progress: "Note A written.", checks: 1, stalls: 0 });
      // The label is in the chat as a system line, not as something the user said.
      const labels = (
        await db.$client.query(
          "select content, role from message where conversation_id = $1 and role = 'system'",
          [c],
        )
      ).rows;
      expect(labels.map((r) => r.content)).toContain("↻ Continuing: Two notes");
      // Second check finishes the work; the done check agrees (fake check says met), so the bot may close the task.
      verdict = '{"met":true,"reason":""}';
      script = [
        async () =>
          [
            await doStep(1, "Both notes written.")(),
            fence("task", { action: "update", id: parent.id, status: "done" }),
          ].join("\n"),
        "All done.",
      ];
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second' where id = $1",
        [parent.id],
      );
      await real.tickAndWait();
      now = await fresh(parent.id);
      expect(now.task).toMatchObject({ status: "done", followUp: "off" });
      expect(now.steps.map((x) => x.status)).toEqual(["done", "done"]);
      void bot;
    });
    test("a message in the chat makes the followed task wait for a quiet chat", async () => {
      reset();
      const { task, say } = await followed("Waits for me");
      await say("How is it going?", "Fine, still on it.");
      await waitFor(
        async () => +(await fresh(task.id)).task.nextCheckAt! > Date.now() + QUIET_MS - 10_000,
      );
      expect((await fresh(task.id)).task.followUp).toBe("auto");
    });
    test("pressing Stop on a running turn pauses the bot's followed tasks in that chat", async () => {
      reset();
      const { task, c, say } = await followed("Stopped by the user");
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      const running = say("Keep going", async () => {
        await hold;
        return "Stopped.";
      });
      await waitFor(() => prompts.length > 0);
      const stop = await call("POST", `/api/conversations/${c}/cancel`);
      expect(stop.status).toBe(200);
      release();
      await running;
      await waitFor(async () => (await fresh(task.id)).task.followUp === "paused");
      expect((await fresh(task.id)).task.followUpReason).toBe("stopped by you");
    });
    test("a turn that ends makes the bot's followed tasks wait, and Stop in the chat pauses them", async () => {
      reset();
      const t = await made("Quiet after turn");
      await db.$client.query(
        "update task set next_check_at = now() - interval '1 second' where id = $1",
        [t.id],
      );
      await tasks.quiet(A, t.botId!, t.conversationId!);
      expect(+(await fresh(t.id)).task.nextCheckAt! - Date.now()).toBeGreaterThan(QUIET_MS - 5_000);
      const stopped = await tasks.pauseFollowUps(A, t.botId!, t.conversationId!, "stopped by you");
      expect(stopped.map((x) => x.id)).toContain(t.id);
      expect((await fresh(t.id)).task.followUp).toBe("paused");
    });
  });
});

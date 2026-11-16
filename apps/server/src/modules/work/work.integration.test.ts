import type { CatchUpCardItem } from "@zetta/core/catch-up";
import { uuidv7 } from "@zetta/core/uuid";
import { INTERNAL_WORDS } from "@zetta/core/work-suggestions";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation } from "@zetta/db/schema/chat";
import { attentionItem } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { task as taskTable } from "@zetta/db/schema/tasks";
import { team, teamPerson } from "@zetta/db/schema/teams";
import { createApp } from "../../app";
import { cleanupTestUsers, resetOrgChart } from "../../test-support/db-cleanup";
import { createCatchUpActions } from "../catch-up/act";
import { createIdentityAccess } from "../identity/access";
import { createOrgStore } from "../org/store";
import { createProjectStore } from "../projects/store";
import { createTaskStore } from "../tasks/store";
import { createTeamPeople } from "../teams/people";
import { createWorkActions } from "./actions";
import { createWorkScan } from "./scan";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
// A the manager, B a stranger, C and D people of A's team
const ids = [
  `work-a-${uuidv7()}`,
  `work-b-${uuidv7()}`,
  `work-c-${uuidv7()}`,
  `work-d-${uuidv7()}`,
];
const [A, B, C, D] = ids as [string, string, string, string];
const HOUR = 60 * 60_000;

suite("work cards against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const tasks = createTaskStore(db);
  const projects = createProjectStore(db);
  const people = createTeamPeople(db);
  /** The clock of the scan and of the buttons. A Wednesday noon, so "a working day later" stays inside the week. */
  let clock = new Date("2026-11-11T12:00:00Z");
  const now = () => clock;
  const said: { where: "chat" | "queue" | "room"; id: string; content: string }[] = [];
  const chatState = { busy: false };
  const chat = {
    isBusy: async () => chatState.busy,
    async startTurn(_a: unknown, conversationId: string, input: { content: string }) {
      said.push({ where: "chat", id: conversationId, content: input.content });
      return { rec: {}, follow: async function* () {} };
    },
    async enqueue(_a: unknown, conversationId: string, input: { content: string }) {
      said.push({ where: "queue", id: conversationId, content: input.content });
      return {};
    },
    async createConversation(a: { userId: string }, botId: string) {
      const [row] = await db
        .insert(conversation)
        .values({ ownerUserId: a.userId, botId, title: "t" } as never)
        .returning();
      return row;
    },
  };
  const discussions = {
    byConversation: async () => undefined,
    async postAsOwner(_a: unknown, id: string, content: string) {
      said.push({ where: "room", id, content });
    },
  };
  const paused = new Set<string>();
  const work = createWorkActions({
    db,
    tasks,
    chat: chat as never,
    discussions: discussions as never,
    now,
  });
  const scan = createWorkScan({ db, ownerPaused: async (id) => paused.has(id), now });
  tasks.onBlocked = (t) => void work.blocked(t.id);
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
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    tasks: { access, tasks, work },
    catchUp: {
      access,
      catchUp: { db, listProposals: async () => [], work },
      actions: createCatchUpActions({ db, tasks, work } as never),
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async <T = Record<string, never>>(
    as: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await app.handle(
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
    return { status: res.status, body: (await res.json()) as T & { error?: { message: string } } };
  };
  const actorOf = (id: string) => access.requireActive(new Headers({ "x-test-user": id }));
  const inbox = async (as: string) =>
    (await call<{ items: CatchUpCardItem[] }>(as, "GET", "/api/catch-up")).body.items.filter((i) =>
      i.kind.startsWith("work_"),
    );
  const cardFor = async (as: string, taskId: string, kind?: string) =>
    (await inbox(as)).find((c) => c.subjectId === taskId && (!kind || c.kind === kind));
  const act = (as: string, card: { id: string }, body: object = {}) =>
    call<{ ok: boolean; done: string }>(as, "POST", `/api/catch-up/${card.id}/act`, body);
  const rowOf = async (id: string) =>
    (await db.select().from(taskTable).where(eq(taskTable.id, id)))[0]!;
  /** Makes a task look untouched since `at`: the scan reads `updatedAt`. */
  const age = (id: string, at: Date) =>
    db.update(taskTable).set({ updatedAt: at }).where(eq(taskTable.id, id));
  const ago = (ms: number) => new Date(+clock - ms);
  let teamId = "";
  let scribe = "",
    painter = "";
  let chatId = "";
  const newBot = async (name: string) =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId: A,
          name,
          slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
          harness: "fixture",
        } as never)
        .returning()
    )[0]!.id;
  /** A bot task in progress in the bot's chat with the manager. */
  const botTask = async (title: string, over: object = {}) =>
    tasks.create(
      await actorOf(A),
      { title, status: "in_progress", ...over },
      { botId: scribe, conversationId: chatId },
    );
  /** A task the manager asked a person for. */
  const personTask = async (title: string, who = C, over: object = {}) =>
    tasks.ask(await actorOf(A), { title, assigneeUserId: who, teamId, attention: "none", ...over });

  beforeAll(async () => {
    const at = new Date();
    await db.insert(user).values(
      ids.map((id, i) => ({
        id,
        name: ["Allan", "Stranger", "Ana", "Davi"][i]!,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: at,
        updatedAt: at,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: at, updatedAt: at })),
      );
    const [made] = await db
      .insert(team)
      .values({ ownerUserId: A, name: `Crew ${A}` })
      .returning();
    teamId = made!.id;
    await people.add(teamId, C);
    await people.add(teamId, D);
    scribe = await newBot("Scribe");
    painter = await newBot("Painter");
    chatId = (await chat.createConversation({ userId: A }, scribe))!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });
  beforeEach(async () => {
    clock = new Date("2026-11-11T12:00:00Z");
    said.length = 0;
    chatState.busy = false;
    paused.clear();
    // Each test starts with an empty Inbox and an empty board.
    await db.delete(attentionItem).where(inArray(attentionItem.ownerUserId, ids));
    await db.delete(taskTable).where(inArray(taskTable.ownerUserId, ids));
  });

  test("a bot that stopped reaches its manager with the step it was on, why, and what to do next", async () => {
    const t = await botTask("Launch email", { followUp: "auto" });
    for (const step of ["Outline", "Draft", "Review"])
      await tasks.create(await actorOf(A), { title: step, parentTaskId: t.id });
    const [first] = await tasks.subtasks(await actorOf(A), t.id);
    await tasks.update(await actorOf(A), first!.id, { status: "done" });
    await tasks.pauseFollowUp(t.id, "no progress recorded in the last 3 follow-ups");
    await work.stopped(t.id, "no progress recorded in the last 3 follow-ups");
    const card = (await cardFor(A, t.id))!;
    expect(card).toMatchObject({
      kind: "work_stuck",
      botId: scribe,
      title: "Scribe stopped on “Launch email”",
      detail: "It was on step 2 of 3. It tried 3 times and nothing changed.",
      resultLink: `/tasks/${t.id}`,
    });
    expect(card.work).toMatchObject({
      task: { id: t.id, title: "Launch email", stepsDone: 1, stepsTotal: 3 },
      worker: { kind: "bot", id: scribe, name: "Scribe" },
      history: [],
    });
    expect(card.work!.options.map((o) => o.label)).toEqual([
      "Tell it what to do",
      "Ask it to continue",
      "Give it to someone else",
      "Give it more time",
    ]);
    expect(card.work!.candidates.map((c) => c.name).sort()).toEqual(["Ana", "Davi", "Painter"]);
    const shown = [
      card.title,
      card.detail,
      ...card.work!.options.flatMap((o) => [o.label, o.effect]),
    ];
    expect(shown.join(" ")).not.toMatch(INTERNAL_WORDS);
    // Nobody else hears about it.
    for (const other of [B, C, D]) expect(await inbox(other)).toEqual([]);
  });

  test("when the company chart puts another person over the bot, the card stays with the owner and says who else should hear", async () => {
    const org = createOrgStore(db);
    const admin = { userId: A, isAdmin: true } as never;
    const version = async () => (await org.get(admin)).chart.version;
    const idOf = async (title: string) =>
      (await org.get(admin)).positions.find((p) => p.title === title)!.id;
    await resetOrgChart(db);
    try {
      // CEO (A, the owner) ─ Engineering manager (C, a person of the team, named Ana) ─ Developer (Scribe)
      await db.update(bot).set({ visibility: "team" }).where(eq(bot.id, scribe));
      await org.create(admin, await version(), { templateKey: "ceo" });
      await org.seat(admin, await version(), await idOf("CEO"), { kind: "person", userId: A });
      await org.create(admin, await version(), {
        parentId: await idOf("CEO"),
        templateKey: "eng-manager",
      });
      await org.seat(admin, await version(), await idOf("Engineering manager"), {
        kind: "person",
        userId: C,
      });
      await org.create(admin, await version(), {
        parentId: await idOf("Engineering manager"),
        templateKey: "software-engineer",
      });
      await org.seat(admin, await version(), await idOf("Software engineer"), {
        kind: "bot",
        botId: scribe,
      });

      const t = await botTask("Chart note", { followUp: "auto" });
      await tasks.pauseFollowUp(t.id, "no progress recorded in the last 3 follow-ups");
      await work.stopped(t.id, "no progress recorded in the last 3 follow-ups");
      const card = (await cardFor(A, t.id))!;
      expect(card.detail).toContain(
        "In the company chart, Scribe reports to Ana (Engineering manager). The task is yours, so this card is yours; Ana got a heads-up.",
      );
      expect(card.detail).not.toMatch(INTERNAL_WORDS);
      // Only the owner can act on a task, so only the owner gets the card with buttons: the person above the bot gets none.
      for (const other of [B, C, D]) expect(await inbox(other)).toEqual([]);
      const headsUp = (as: string, taskId: string) =>
        db
          .select()
          .from(attentionItem)
          .where(
            and(
              eq(attentionItem.ownerUserId, as),
              eq(attentionItem.kind, "work_heads_up"),
              eq(attentionItem.subjectId, taskId),
            ),
          );
      // The task is on no project, so C could not read it: the heads-up says who stopped, never what the task is.
      const [fyi] = await headsUp(C, t.id);
      expect(fyi!.title).toMatch(/^Scribe stopped on a task from .+/);
      expect(`${fyi!.title} ${fyi!.detail}`).not.toContain("Chart note");
      expect(fyi!.resultLink).toBeNull();
      expect(fyi!.detail).toContain("decides what to do");
      expect(`${fyi!.title} ${fyi!.detail}`).not.toMatch(INTERNAL_WORDS);
      for (const other of [A, B, D]) expect(await headsUp(other, t.id)).toEqual([]);

      // On a project that C is a person of, C may read the task, so the heads-up names it and links to it.
      const proj = await projects.create(await actorOf(A), {
        name: `Chart ${uuidv7().slice(-6)}`,
        bots: [scribe],
        people: [C],
      });
      const shared = await botTask("Seen on the project", { followUp: "auto", projectId: proj.id });
      await tasks.pauseFollowUp(shared.id, "the room is closed");
      await work.stopped(shared.id, "the room is closed");
      const [seen] = await headsUp(C, shared.id);
      expect(seen!.title).toBe(`Scribe stopped on “Seen on the project”`);
      expect(seen!.resultLink).toBe(`/tasks/${shared.id}`);
      // A person who left the team no longer reads it: the heads-up falls back to the plain one.
      await db
        .delete(teamPerson)
        .where(and(eq(teamPerson.teamId, teamId), eq(teamPerson.userId, C)));
      const gone = await botTask("After C left", { followUp: "auto", projectId: proj.id });
      await tasks.pauseFollowUp(gone.id, "the room is closed");
      await work.stopped(gone.id, "the room is closed");
      const [plain] = await headsUp(C, gone.id);
      expect(plain!.title).toMatch(/^Scribe stopped on a task from /);
      expect(plain!.resultLink).toBeNull();
      // The team and Scribe's projects are shared by the tests that follow: put C back, and let the project go.
      await people.add(teamId, C);
      await projects.update(await actorOf(A), proj.id, { status: "archived" });

      // When the nearest person above the bot is the owner, the chart adds nothing.
      await org.seat(admin, await version(), await idOf("Engineering manager"), {
        kind: "person",
        userId: A,
      });
      const again = await botTask("Owner is the manager", { followUp: "auto" });
      await tasks.pauseFollowUp(again.id, "no progress recorded in the last 3 follow-ups");
      await work.stopped(again.id, "no progress recorded in the last 3 follow-ups");
      expect((await cardFor(A, again.id))!.detail).not.toContain("company chart");
    } finally {
      await resetOrgChart(db);
    }
  });

  test("telling the bot what to do sends the words to its chat, starts it again and closes the card", async () => {
    const t = await botTask("Launch email", { followUp: "auto" });
    await tasks.pauseFollowUp(t.id, "no progress recorded in the last 3 follow-ups");
    await work.stopped(t.id, "no progress recorded in the last 3 follow-ups");
    const card = (await cardFor(A, t.id))!;
    // The message is the point of the button: without one nothing is sent and the card stays.
    const empty = await act(A, card, { option: "tell" });
    expect(empty.status).toBe(400);
    expect(empty.body.error?.message).toBe("Write a message first: “Tell it what to do” sends it.");
    expect(said).toEqual([]);
    const done = await act(A, card, { option: "tell", text: "Use the short version." });
    expect(done.body).toEqual({
      ok: true,
      done: "Sent to Scribe. It reads it now and goes on from there.",
    });
    expect(said).toEqual([
      {
        where: "chat",
        id: chatId,
        content: `About the task “Launch email” (id ${t.id}): Use the short version.`,
      },
    ]);
    expect((await rowOf(t.id)).followUp).toBe("auto");
    expect(await cardFor(A, t.id)).toBeUndefined();
    // The next card about the same task remembers what the manager said.
    await tasks.pauseFollowUp(t.id, "no progress recorded in the last 3 follow-ups");
    await work.stopped(t.id, "no progress recorded in the last 3 follow-ups");
    const again = (await cardFor(A, t.id))!;
    expect(again.id).not.toBe(card.id);
    expect(again.work!.history).toMatchObject([
      { action: "tell", label: "Tell it what to do", text: "Use the short version." },
    ]);
    // A busy chat queues the words instead of losing them.
    chatState.busy = true;
    said.length = 0;
    await act(A, again, { option: "tell", text: "And add a subject line." });
    expect(said.map((s) => s.where)).toEqual(["queue"]);
  });

  test("an answer that leaves the task as it was keeps the card away for a working day, and a task that moved raises nothing", async () => {
    const t = await botTask("Quiet after answer");
    await age(t.id, ago(3 * HOUR));
    expect(await scan.tick()).toMatchObject({ bots: 1 });
    const card = (await cardFor(A, t.id))!;
    const told = await act(A, card, { option: "tell", text: "Move to done" });
    expect(told.status).toBe(200);
    expect(await cardFor(A, t.id)).toBeUndefined();
    // The scan runs again soon after the answer, and later the same day: the card does not come back.
    clock = new Date(+clock + 10 * 60_000);
    expect(await scan.tick()).toMatchObject({ bots: 0 });
    clock = new Date(+clock + 5 * HOUR);
    expect(await scan.tick()).toMatchObject({ bots: 0 });
    expect(await cardFor(A, t.id)).toBeUndefined();
    // A working day later the task is still as it was: the manager hears again, and sees what they said.
    clock = new Date(+clock + 24 * HOUR);
    expect(await scan.tick()).toMatchObject({ bots: 1 });
    expect((await cardFor(A, t.id))!.work!.history).toMatchObject([
      { action: "tell", text: "Move to done" },
    ]);
  });

  test("a task the bot moved after the answer raises no card", async () => {
    const t = await botTask("Moved after answer");
    await age(t.id, ago(3 * HOUR));
    expect(await scan.tick()).toMatchObject({ bots: 1 });
    await act(A, (await cardFor(A, t.id))!, { option: "tell", text: "Move to done" });
    await tasks.update(await actorOf(A), t.id, { status: "done" }, { by: "bot" });
    clock = new Date(+clock + 30 * HOUR);
    expect(await scan.tick()).toMatchObject({ bots: 0 });
    expect(await cardFor(A, t.id)).toBeUndefined();
  });

  test("the first option is what the A key does, and an option the card does not have is refused", async () => {
    const t = await botTask("Report", { followUp: "auto" });
    await tasks.pauseFollowUp(t.id, "the room is closed");
    await work.stopped(t.id, "the room is closed");
    const card = (await cardFor(A, t.id))!;
    expect((await act(A, card, { option: "its_done" })).status).toBe(400);
    expect((await act(B, card, { option: "resume" })).status).toBe(404);
    const resumed = await act(A, card, { option: "resume" });
    expect(resumed.body.done).toBe("Scribe picks it up again in a couple of minutes.");
    expect((await rowOf(t.id)).followUp).toBe("auto");
    expect(await cardFor(A, t.id)).toBeUndefined();
  });

  test("giving the task to another bot or to a person moves it and tells them", async () => {
    const t = await botTask("Banner", {
      followUp: "auto",
      description: "A banner for the home page",
    });
    await tasks.create(await actorOf(A), { title: "Sketch", parentTaskId: t.id });
    await tasks.pauseFollowUp(t.id, "the room is closed");
    await work.stopped(t.id, "the room is closed");
    const card = (await cardFor(A, t.id))!;
    expect((await act(A, card, { option: "reassign" })).body.error?.message).toBe(
      "Pick who gets the task first.",
    );
    expect((await act(A, card, { option: "reassign", target: `person:${B}` })).status).toBe(400);
    const toBot = await act(A, card, { option: "reassign", target: `bot:${painter}` });
    expect(toBot.body.done).toBe("Given to Painter. It has been told and starts now.");
    const moved = await rowOf(t.id);
    expect(moved).toMatchObject({ botId: painter, assignee: "bot", followUp: "auto", stalls: 0 });
    expect(moved.conversationId).not.toBe(chatId);
    expect(said.at(-1)).toMatchObject({ where: "chat", id: moved.conversationId! });
    expect(said.at(-1)!.content).toContain("The task “Banner” is yours now.");
    expect(said.at(-1)!.content).toContain("A banner for the home page");
    const [step] = await db.select().from(taskTable).where(eq(taskTable.parentTaskId, t.id));
    expect(step).toMatchObject({ botId: painter, conversationId: moved.conversationId });
    // To a person: it becomes theirs, with a card in their Inbox.
    await tasks.pauseFollowUp(t.id, "the room is closed");
    await work.stopped(t.id, "the room is closed");
    const second = (await cardFor(A, t.id))!;
    const toPerson = await act(A, second, { option: "reassign", target: `person:${C}` });
    expect(toPerson.body.done).toBe("Given to Ana. It is in their Inbox.");
    expect(await rowOf(t.id)).toMatchObject({
      assignee: "person",
      assigneeUserId: C,
      teamId,
      botId: null,
      followUp: "off",
    });
    const [theirs] = await db
      .select()
      .from(attentionItem)
      .where(and(eq(attentionItem.ownerUserId, C), eq(attentionItem.kind, "task_ask")));
    expect(theirs).toMatchObject({ subjectId: t.id, title: "Banner", status: "open" });
  });

  test("a task on a project is offered to the others on that project only", async () => {
    const p = await projects.create(await actorOf(A), {
      name: `Launch ${uuidv7().slice(-6)}`,
      bots: [scribe, painter],
      people: [C],
    });
    const t = await botTask("On the project", { followUp: "auto", projectId: p.id });
    await tasks.pauseFollowUp(t.id, "the room is closed");
    await work.stopped(t.id, "the room is closed");
    const card = (await cardFor(A, t.id))!;
    expect(card.work!.project).toEqual({ id: p.id, name: p.name });
    expect(card.work!.candidates.map((c) => c.name).sort()).toEqual(["Ana", "Painter"]);
    expect((await act(A, card, { option: "reassign", target: `person:${D}` })).status).toBe(400);
  });

  test("give it more time: the card goes away until tomorrow, unless the task changes", async () => {
    const t = await botTask("Slow one");
    await age(t.id, ago(3 * HOUR));
    expect(await scan.tick()).toMatchObject({ bots: 1 });
    const card = (await cardFor(A, t.id))!;
    expect(card.title).toBe("Scribe has not moved “Slow one”");
    // A second pass does not raise a second card.
    expect(await scan.tick()).toMatchObject({ bots: 0 });
    const later = await act(A, card, { option: "more_time" });
    expect(later.body.done).toBe("Okay. You hear about it again tomorrow if nothing changes.");
    expect(await cardFor(A, t.id)).toBeUndefined();
    clock = new Date(+clock + 5 * HOUR);
    expect(await scan.tick()).toMatchObject({ bots: 0 });
    // A working day later it is said again.
    clock = new Date(+clock + 20 * HOUR);
    expect(await scan.tick()).toMatchObject({ bots: 1 });
    // "Not now" (the D key) asks for the same quiet.
    const again = (await cardFor(A, t.id))!;
    expect((await call(A, "POST", `/api/catch-up/${again.id}/deny`)).status).toBe(200);
    expect(await scan.tick()).toMatchObject({ bots: 0 });
    // Any change to the task ends the quiet: it is looked at fresh.
    await tasks.update(await actorOf(A), t.id, { progress: "half done" }, { by: "bot" });
    await age(t.id, ago(3 * HOUR));
    expect(await scan.tick()).toMatchObject({ bots: 1 });
  });

  test("a quiet bot task is reported after its wait, and each project sets how long that is", async () => {
    const actor = await actorOf(A);
    const mk = async (watch: "close" | "normal" | "light") =>
      (await projects.create(actor, { name: `${watch} ${uuidv7().slice(-6)}`, watch })).id;
    const close = await botTask("Watched closely", { projectId: await mk("close") });
    const normal = await botTask("Watched normally", { projectId: await mk("normal") });
    const light = await botTask("Watched lightly", { projectId: await mk("light") });
    const followed = await botTask("Called back anyway", { followUp: "auto" });
    const finished = await botTask("Finished", { status: "done" });
    for (const t of [close, normal, light, followed, finished]) await age(t.id, ago(1.5 * HOUR));
    await scan.tick();
    const flagged = async () => (await inbox(A)).map((c) => c.work!.task.title).sort();
    expect(await flagged()).toEqual(["Watched closely"]);
    for (const t of [normal, light]) await age(t.id, ago(2.5 * HOUR));
    await scan.tick();
    expect(await flagged()).toEqual(["Watched closely", "Watched normally"]);
    await age(light.id, ago(4.5 * HOUR));
    await scan.tick();
    expect(await flagged()).toEqual(["Watched closely", "Watched lightly", "Watched normally"]);
    // The card ends by itself when the task moves again.
    await tasks.update(actor, normal.id, { progress: "moving" }, { by: "bot" });
    expect(await flagged()).toEqual(["Watched closely", "Watched lightly"]);
  });

  test("a manager who paused their agents is not told that their bots are quiet", async () => {
    const t = await botTask("Paused on purpose");
    await age(t.id, ago(5 * HOUR));
    paused.add(A);
    expect(await scan.tick()).toMatchObject({ bots: 0 });
    paused.clear();
    expect(await scan.tick()).toMatchObject({ bots: 1 });
  });

  test("a person who was asked and did not start is reported after a working day, not over a weekend", async () => {
    const t = await personTask("Send the price list");
    // Asked on Friday evening; it is Monday morning: four working hours passed, not sixty.
    clock = new Date("2026-11-16T04:00:00Z");
    await age(t.id, new Date("2026-11-13T18:00:00Z"));
    expect(await scan.tick()).toMatchObject({ waiting: 0 });
    clock = new Date("2026-11-17T09:00:00Z");
    expect(await scan.tick()).toMatchObject({ waiting: 1 });
    const card = (await cardFor(A, t.id))!;
    expect(card.title).toBe("Ana has not answered about “Send the price list”");
    expect(card.botId).toBeNull();
    expect(card.work!.worker).toEqual({ kind: "person", id: C, name: "Ana" });
    expect(card.work!.options.map((o) => o.label)).toEqual([
      "Tell Ana",
      "Give it to someone else",
      "Give it more time",
    ]);
    // Ana herself is not sent a second card about it, and Davi sees nothing.
    expect(await inbox(C)).toEqual([]);
    expect(await inbox(D)).toEqual([]);
  });

  test("a person whose task went quiet is asked first; their manager hears only if they do not answer", async () => {
    const t = await personTask("Pricing table");
    await tasks.update(await actorOf(C), t.id, { status: "in_progress" });
    await age(t.id, ago(49 * HOUR));
    // Wednesday noon, 49 hours back is Monday morning: two working days.
    expect(await scan.tick()).toMatchObject({ asked: 1, told: 0, waiting: 0 });
    expect(await inbox(A)).toEqual([]);
    const ask = (await cardFor(C, t.id))!;
    expect(ask).toMatchObject({ kind: "work_checkin", title: "Still working on “Pricing table”?" });
    expect(ask.work!.options.map((o) => o.label)).toEqual([
      "Yes, on it",
      "I'm blocked",
      "It's done",
    ]);
    expect(
      [ask.title, ask.detail, ...ask.work!.options.map((o) => o.effect)].join(" "),
    ).not.toMatch(INTERNAL_WORDS);
    // Asking again on the next pass would be nagging.
    expect(await scan.tick()).toMatchObject({ asked: 0, told: 0 });
    // One tap: nobody is told, and they are left alone for two more working days.
    expect((await act(C, ask, { option: "on_it" })).body.done).toBe("Thanks.");
    expect(await inbox(C)).toEqual([]);
    clock = new Date(+clock + 30 * HOUR);
    expect(await scan.tick()).toMatchObject({ asked: 0, told: 0 });
    expect(await inbox(A)).toEqual([]);
    // Still nothing after those two working days: they are asked once more, and the manager still hears nothing.
    clock = new Date(+clock + 24 * HOUR);
    expect(await scan.tick()).toMatchObject({ asked: 1, told: 0 });
    expect(await inbox(A)).toEqual([]);
  });

  test("no answer within a working day reaches the manager", async () => {
    const t = await personTask("Pricing table");
    await tasks.update(await actorOf(C), t.id, { status: "in_progress" });
    const stale = ago(49 * HOUR);
    await age(t.id, stale);
    await scan.tick();
    clock = new Date(+clock + 10 * HOUR);
    expect(await scan.tick()).toMatchObject({ told: 0 });
    clock = new Date(+clock + 15 * HOUR);
    expect(await scan.tick()).toMatchObject({ told: 1 });
    const card = (await cardFor(A, t.id))!;
    expect(card.title).toBe("Ana has not answered about “Pricing table”");
    expect(card.detail).toContain("did not answer when asked");
  });

  test("a project watched lightly checks on nobody", async () => {
    const p = await projects.create(await actorOf(A), {
      name: `Hands off ${uuidv7().slice(-6)}`,
      watch: "light",
      people: [C],
    });
    const asked = await personTask("Not started", C, { projectId: p.id });
    const quiet = await personTask("Gone quiet", C, { projectId: p.id });
    await tasks.update(await actorOf(C), quiet.id, { status: "in_progress" });
    for (const t of [asked, quiet]) await age(t.id, ago(200 * HOUR));
    expect(await scan.tick()).toEqual({ bots: 0, waiting: 0, asked: 0, told: 0 });
  });

  test("a person who says they are blocked says why, and the manager gets that", async () => {
    const t = await personTask("Pricing table");
    await tasks.update(await actorOf(C), t.id, { status: "in_progress" });
    await age(t.id, ago(49 * HOUR));
    await scan.tick();
    const ask = (await cardFor(C, t.id))!;
    expect((await act(C, ask, { option: "im_blocked" })).status).toBe(400);
    const told = await act(C, ask, { option: "im_blocked", text: "Waiting for the legal text." });
    expect(told.body.done).toBe("Allan was told, so they can help.");
    await Bun.sleep(30);
    expect(await rowOf(t.id)).toMatchObject({
      status: "blocked",
      progress: "Waiting for the legal text.",
    });
    const card = (await cardFor(A, t.id, "work_blocked"))!;
    expect(card).toMatchObject({
      title: "Ana is blocked on “Pricing table”",
      detail: "Waiting for the legal text.",
    });
    expect(card.work!.note).toBe("Waiting for the legal text.");
    expect(await inbox(C)).toEqual([]);
    // The card ends when the task leaves Blocked.
    await tasks.update(await actorOf(C), t.id, { status: "in_progress" });
    expect(await cardFor(A, t.id)).toBeUndefined();
  });

  test("a task blocked from the task page carries the reason too, and blocking your own task tells nobody", async () => {
    const t = await personTask("Send the logo");
    const res = await call(C, "PATCH", `/api/tasks/${t.id}`, {
      status: "blocked",
      progress: "I have no access to the drive",
    });
    expect(res.status).toBe(200);
    await Bun.sleep(30);
    expect((await cardFor(A, t.id, "work_blocked"))?.detail).toBe("I have no access to the drive");
    // The person still changes nothing else.
    expect((await call(C, "PATCH", `/api/tasks/${t.id}`, { title: "Mine" })).status).toBe(403);
    // A bot that blocks its own task reports it the same way.
    const b = await botTask("Deploy");
    await tasks.update(
      await actorOf(A),
      b.id,
      { status: "blocked", progress: "No access to the server" },
      { by: "bot" },
    );
    await Bun.sleep(30);
    expect((await cardFor(A, b.id, "work_blocked"))?.title).toBe("Scribe is blocked on “Deploy”");
    // The owner moving their own task to Blocked is their own note.
    const own = await tasks.create(await actorOf(A), { title: "Mine" });
    await tasks.update(await actorOf(A), own.id, { status: "blocked" });
    await Bun.sleep(30);
    expect(await cardFor(A, own.id)).toBeUndefined();
  });

  test("the manager writes to a person about a task: it lands in their Inbox, and the answer comes back", async () => {
    const t = await personTask("Send the logo");
    const sent = await call<{ done: string }>(A, "POST", `/api/tasks/${t.id}/tell`, {
      text: "Any news on this?",
    });
    expect(sent.body.done).toBe(
      "Sent to Ana. It is in their Inbox, and the answer comes back to you.",
    );
    const card = (await cardFor(C, t.id))!;
    expect(card).toMatchObject({
      kind: "work_nudge",
      title: "Allan about “Send the logo”",
      detail: "Any news on this?",
    });
    expect(card.work!.options.map((o) => o.label)).toEqual([
      "Reply",
      "Yes, on it",
      "I'm blocked",
      "It's done",
    ]);
    expect((await act(C, card, { option: "reply", text: "Tomorrow morning." })).body.done).toBe(
      "Sent to Allan.",
    );
    // The answer is news for the manager, not another decision in the queue.
    const [news] = await db
      .select()
      .from(attentionItem)
      .where(and(eq(attentionItem.ownerUserId, A), eq(attentionItem.kind, "work_reply")));
    expect(news).toMatchObject({
      title: "Ana about “Send the logo”",
      detail: "Tomorrow morning.",
      subjectId: t.id,
    });
    expect(await inbox(A)).toEqual([]);
    // Only the owner of a task writes about it, and not to themselves.
    expect((await call(C, "POST", `/api/tasks/${t.id}/tell`, { text: "x" })).status).toBe(404);
    expect((await call(B, "POST", `/api/tasks/${t.id}/tell`, { text: "x" })).status).toBe(404);
    const own = await tasks.ask(await actorOf(A), {
      title: "Mine",
      assigneeUserId: A,
      attention: "none",
    });
    expect((await call(A, "POST", `/api/tasks/${own.id}/tell`, { text: "x" })).status).toBe(409);
    expect((await call(A, "POST", `/api/tasks/${t.id}/tell`, { text: "  " })).status).toBe(400);
  });

  test("the manager writes to a bot about any task, flagged or not", async () => {
    const t = await botTask("Draft the FAQ");
    const sent = await call<{ done: string }>(A, "POST", `/api/tasks/${t.id}/tell`, {
      text: "Keep the answers short.",
    });
    expect(sent.body.done).toBe("Sent to Scribe. It reads it now and goes on from there.");
    expect(said).toEqual([
      {
        where: "chat",
        id: chatId,
        content: `About the task “Draft the FAQ” (id ${t.id}): Keep the answers short.`,
      },
    ]);
    // A task nobody does has nobody to tell.
    const loose = await tasks.create(await actorOf(A), { title: "Loose" });
    const none = await call(A, "POST", `/api/tasks/${loose.id}/tell`, { text: "x" });
    expect(none.status).toBe(409);
    expect(none.body.error?.message).toBe("Nobody is on this task yet. Give it to someone first.");
  });

  test("a card about a task that was deleted says so instead of failing", async () => {
    const t = await botTask("Short lived", { followUp: "auto" });
    await tasks.pauseFollowUp(t.id, "the room is closed");
    await work.stopped(t.id, "the room is closed");
    const [row] = await db
      .select()
      .from(attentionItem)
      .where(and(eq(attentionItem.ownerUserId, A), eq(attentionItem.subjectId, t.id)));
    await tasks.remove(await actorOf(A), t.id);
    // The Inbox drops it on the next read; a click that raced the delete gets a sentence.
    const late = await act(A, row!, { option: "resume" });
    expect(late.status).toBe(409);
    expect(late.body.error?.message).toBe("The task this card is about is gone. Dismiss the card.");
    expect(await inbox(A)).toEqual([]);
  });
});

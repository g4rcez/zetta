import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation } from "@zetta/db/schema/chat";
import { discussion } from "@zetta/db/schema/discussions";
import { membership } from "@zetta/db/schema/identity";
import { task as taskTable } from "@zetta/db/schema/tasks";
import { team } from "@zetta/db/schema/teams";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import type { ChatService } from "../chat/service";
import { createOneShot } from "../chat/one-shot";
import { TurnBusyError } from "../chat/turns";
import { createIdentityAccess } from "../identity/access";
import { AgentsPausedError } from "../preferences/agents-state";
import { createTaskStore } from "../tasks/store";
import { createTeamPeople } from "../teams/people";
import { createProjectDraft } from "./draft";
import { createProjectStore, type ProjectDetail, type ProjectSummary } from "./store";
import { createProjectWork, taskFromText } from "./work";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
// 0 owner, 1 stranger, 2 team person on the project, 3 team person not on the project
const ids = [
  `proj-a-${uuidv7()}`,
  `proj-b-${uuidv7()}`,
  `proj-c-${uuidv7()}`,
  `proj-d-${uuidv7()}`,
];
const [A, B, C, D] = ids as [string, string, string, string];

test("the first line of what the manager wrote names the task", () => {
  expect(taskFromText("Write the launch email")).toEqual({
    title: "Write the launch email",
    description: "",
  });
  expect(taskFromText("Write the launch email\nKeep it under 200 words.")).toEqual({
    title: "Write the launch email",
    description: "Write the launch email\nKeep it under 200 words.",
  });
  expect(taskFromText("x".repeat(300)).title).toHaveLength(200);
});

suite("projects against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const tasks = createTaskStore(db);
  const projects = createProjectStore(db);
  const people = createTeamPeople(db);
  const told: string[][] = [];
  projects.onChange = (userIds) => void told.push(userIds);
  /** What the fake chat was asked to do, newest last. */
  const chatCalls: { kind: "turn" | "queue" | "new"; conversationId?: string; content?: string }[] =
    [];
  const chatState = { busy: false, fail: undefined as Error | undefined };
  const chat = {
    isBusy: async () => chatState.busy,
    async startTurn(_a: unknown, conversationId: string, input: { content: string }) {
      if (chatState.fail) throw chatState.fail;
      chatCalls.push({ kind: "turn", conversationId, content: input.content });
      return { rec: {}, follow: async function* () {} };
    },
    async enqueue(_a: unknown, conversationId: string, input: { content: string }) {
      chatCalls.push({ kind: "queue", conversationId, content: input.content });
      return {};
    },
    async createConversation(a: { userId: string }, botId: string) {
      const [row] = await db
        .insert(conversation)
        .values({ ownerUserId: a.userId, botId, title: "t" } as never)
        .returning();
      chatCalls.push({ kind: "new", conversationId: row!.id });
      return row;
    },
  } as unknown as Pick<ChatService, "isBusy" | "startTurn" | "enqueue" | "createConversation">;
  let cliReply = "";
  const draft = createProjectDraft(
    createOneShot(db, {
      cli: async () => {
        if (cliReply === "throw") throw new Error("down");
        return cliReply;
      },
    }),
  );
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
    tasks: { access, tasks },
    projects: { access, projects, work: createProjectWork({ db, tasks, chat }), draft },
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
  let teamId = "";
  let scribe = "",
    painter = "",
    chiefBot = "",
    strangerBot = "";
  let roomId = "",
    roomConversation = "";
  const newBot = async (ownerUserId: string, name: string, kind = "specialist") =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId,
          name,
          slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
          kind,
          visibility: "private",
          harness: kind === "chief" ? "claude" : "fixture",
        } as never)
        .returning()
    )[0]!.id;
  const create = async (name: string, over: object = {}) =>
    (await call<{ project: ProjectDetail }>(A, "POST", "/api/projects", { name, ...over })).body
      .project;
  const read = async (as: string, id: string) =>
    call<{ project: ProjectDetail }>(as, "GET", `/api/projects/${id}`);

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id.slice(0, 6),
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
    await people.add(teamId, D);
    scribe = await newBot(A, "Scribe");
    painter = await newBot(A, "Painter");
    chiefBot = await newBot(A, "Chief", "chief");
    strangerBot = await newBot(B, "Other");
    const [conv] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId: scribe, title: "Room", kind: "discussion" } as never)
      .returning();
    roomConversation = conv!.id;
    const [room] = await db
      .insert(discussion)
      .values({ ownerUserId: A, conversationId: conv!.id, title: "Launch room", openKey: uuidv7() })
      .returning();
    roomId = room!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  test("a project is made with its brief, bots and people, and only its owner manages it", async () => {
    const made = await call<{ project: ProjectDetail }>(A, "POST", "/api/projects", {
      name: "Spring launch",
      outcome: "A launch page and an email",
      doneWhen: "Both are live",
      labels: ["Launch", "launch", " q2 "],
      bots: [scribe],
      people: [C],
    });
    expect(made.status).toBe(201);
    const p = made.body.project;
    expect(p).toMatchObject({
      name: "Spring launch",
      outcome: "A launch page and an email",
      audience: "",
      labels: ["launch", "q2"],
      status: "active",
      watch: "normal",
      role: "owner",
      health: { state: "quiet", sentence: "Nothing has been asked for yet." },
    });
    expect(p.bots).toEqual([{ id: scribe, name: "Scribe" }]);
    expect(p.people.map((x) => x.userId)).toEqual([C]);
    // The stranger sees nothing; the person on the project reads it but may not change it.
    expect((await read(B, p.id)).status).toBe(404);
    expect((await read(D, p.id)).status).toBe(404);
    const asMember = await read(C, p.id);
    expect(asMember.status).toBe(200);
    expect(asMember.body.project.role).toBe("member");
    expect((await call(C, "PATCH", `/api/projects/${p.id}`, { name: "Mine now" })).status).toBe(
      403,
    );
    expect((await call(B, "PATCH", `/api/projects/${p.id}`, { name: "Mine now" })).status).toBe(
      404,
    );
    const lists = await Promise.all(
      [A, B, C].map((id) => call<{ projects: ProjectSummary[] }>(id, "GET", "/api/projects")),
    );
    expect(lists.map((l) => l.body.projects.map((x) => x.name))).toEqual([
      ["Spring launch"],
      [],
      ["Spring launch"],
    ]);
  });

  test("a name is taken while its project is not archived", async () => {
    const taken = await call(A, "POST", "/api/projects", { name: "spring LAUNCH" });
    expect(taken.status).toBe(409);
    expect(taken.body.error?.message).toBe("You already have a project with this name.");
    // Another owner may use the same name.
    expect((await call(B, "POST", "/api/projects", { name: "Spring launch" })).status).toBe(201);
    const old = await create("Old idea");
    await call(A, "PATCH", `/api/projects/${old.id}`, { status: "archived" });
    const again = await create("Old idea");
    expect(again.id).not.toBe(old.id);
    // Bringing the archived one back would make two with one name.
    expect((await call(A, "PATCH", `/api/projects/${old.id}`, { status: "active" })).status).toBe(
      409,
    );
  });

  test("members must be the owner's bots and people of the owner's teams", async () => {
    const p = await create("Members");
    const put = (body: object) => call(A, "PUT", `/api/projects/${p.id}/members`, body);
    expect((await put({ bots: [strangerBot], people: [] })).status).toBe(409);
    expect((await put({ bots: [], people: [B] })).status).toBe(409);
    expect((await put({ bots: [], people: [A] })).status).toBe(409);
    const ok = await call<{ project: ProjectDetail }>(A, "PUT", `/api/projects/${p.id}/members`, {
      bots: [painter, scribe],
      people: [C, D],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.project.bots.map((b) => b.name)).toEqual(["Painter", "Scribe"]);
    expect(ok.body.project.people).toHaveLength(2);
    // The list replaces the members: D leaves and no longer reads the project.
    await put({ bots: [scribe], people: [C] });
    expect((await read(D, p.id)).status).toBe(404);
    const candidates = await call<{
      bots: { id: string }[];
      people: { userId: string }[];
      rooms: { id: string }[];
    }>(A, "GET", "/api/projects/candidates");
    expect(candidates.body.bots.map((b) => b.id).sort()).toEqual(
      [scribe, painter, chiefBot].sort(),
    );
    expect(candidates.body.people.map((x) => x.userId).sort()).toEqual([C, D].sort());
    // Each candidate carries a picture slot and the title to show under the name (empty when none is written).
    expect(candidates.body.people[0]).toHaveProperty("avatar");
    expect(candidates.body.people[0]).toHaveProperty("title");
    expect(candidates.body.rooms.map((r) => r.id)).toEqual([roomId]);
  });

  test("a person who leaves the team stops reading the project", async () => {
    const p = await create("Leaving", { people: [D] });
    expect((await read(D, p.id)).status).toBe(200);
    await people.remove(teamId, D);
    expect((await read(D, p.id)).status).toBe(404);
    expect((await read(A, p.id)).body.project.people).toEqual([]);
    await people.add(teamId, D);
  });

  test("a new task joins the project of its room, else the one project of its bot", async () => {
    const one = await create("Auto one", { bots: [painter] });
    const actor = await actorOf(A);
    // Painter is on exactly one active project (it left "Members" above).
    const byBot = await tasks.create(actor, { title: "Draw the hero" }, { botId: painter });
    expect(byBot.projectId).toBe(one.id);
    // Scribe is on several projects: nothing says which one, so the task stays outside.
    const unclear = await tasks.create(actor, { title: "Write something" }, { botId: scribe });
    expect(unclear.projectId).toBeNull();
    // A room of a project wins over the bot's own project.
    const two = await create("Auto two");
    const rooms = await call<{ project: ProjectDetail }>(
      A,
      "PUT",
      `/api/projects/${two.id}/rooms`,
      { rooms: [roomId] },
    );
    expect(rooms.body.project.rooms.map((r) => r.title)).toEqual(["Launch room"]);
    const inRoom = await tasks.create(
      actor,
      { title: "From the room" },
      { botId: painter, conversationId: roomConversation },
    );
    expect(inRoom.projectId).toBe(two.id);
    // The steps of a task are filed with it, and a plan made in one write too.
    const step = await tasks.create(actor, { title: "Sketch", parentTaskId: byBot.id });
    expect(step.projectId).toBe(one.id);
    const plan = await tasks.createWithSubtasks(actor, { title: "Plan" }, ["a", "b"], {
      botId: painter,
    });
    expect(plan.subtasks.map((s) => s.projectId)).toEqual([one.id, one.id]);
    // A paused project takes no new work by itself.
    await call(A, "PATCH", `/api/projects/${one.id}`, { status: "paused" });
    const later = await tasks.create(actor, { title: "Later" }, { botId: painter });
    expect(later.projectId).toBeNull();
    await call(A, "PATCH", `/api/projects/${one.id}`, { status: "active" });
    // Another project may not take a room that is not the owner's.
    expect(
      (await call(B, "PUT", `/api/projects/${two.id}/rooms`, { rooms: [roomId] })).status,
    ).toBe(404);
    // Taking the room off the list unlinks it.
    await call(A, "PUT", `/api/projects/${two.id}/rooms`, { rooms: [] });
    const [room] = await db.select().from(discussion).where(eq(discussion.id, roomId));
    expect(room!.projectId).toBeNull();
  });

  test("the owner files a task under a project, and its steps follow", async () => {
    const p = await create("Filing");
    const other = (
      await call<{ project: ProjectDetail }>(B, "POST", "/api/projects", { name: "Theirs" })
    ).body.project;
    const made = await call<{ task: { id: string; projectId: string | null } }>(
      A,
      "POST",
      "/api/tasks",
      { title: "Loose" },
    );
    expect(made.body.task.projectId).toBeNull();
    const id = made.body.task.id;
    const step = await call<{ task: { id: string } }>(A, "POST", "/api/tasks", {
      title: "Step",
      parentTaskId: id,
    });
    const moved = await call<{ task: { projectId: string } }>(A, "PATCH", `/api/tasks/${id}`, {
      projectId: p.id,
    });
    expect(moved.body.task.projectId).toBe(p.id);
    const [child] = await db.select().from(taskTable).where(eq(taskTable.id, step.body.task.id));
    expect(child!.projectId).toBe(p.id);
    // Not into somebody else's project, and a step is never moved by itself.
    expect((await call(A, "PATCH", `/api/tasks/${id}`, { projectId: other.id })).status).toBe(404);
    expect(
      (await call(A, "PATCH", `/api/tasks/${step.body.task.id}`, { projectId: null })).status,
    ).toBe(409);
    expect(
      (await call(A, "POST", "/api/tasks", { title: "Direct", projectId: other.id })).status,
    ).toBe(404);
    const direct = await call<{ task: { projectId: string } }>(A, "POST", "/api/tasks", {
      title: "Direct",
      projectId: p.id,
    });
    expect(direct.body.task.projectId).toBe(p.id);
    const out = await call<{ task: { projectId: string | null } }>(A, "PATCH", `/api/tasks/${id}`, {
      projectId: null,
    });
    expect(out.body.task.projectId).toBeNull();
  });

  test("the page says where the project stands and what waits on the owner", async () => {
    const p = await create("Standing", { people: [C] });
    const actor = await actorOf(A);
    const mk = (title: string, status: string, over: object = {}) =>
      tasks.create(actor, { title, status: status as never, projectId: p.id, ...over });
    await mk("Done one", "done");
    await mk("Doing", "in_progress", { progress: "half way" });
    const blocked = await mk("Stuck on legal", "blocked", {
      progress: "waiting for the legal text",
    });
    await mk("Look at this", "review");
    const asked = await tasks.ask(actor, {
      title: "Send the logo",
      assigneeUserId: C,
      teamId,
      projectId: p.id,
    });
    const own = (await read(A, p.id)).body.project;
    expect(own.counts).toMatchObject({
      total: 5,
      done: 1,
      in_progress: 1,
      blocked: 1,
      review: 1,
      backlog: 1,
    });
    expect(own.health).toEqual({
      state: "needs_you",
      sentence: "2 tasks are waiting on you. 1 of 5 done.",
    });
    expect(own.needsYou.map((n) => [n.title, n.why, n.text]).sort()).toEqual([
      ["Look at this", "review", ""],
      ["Stuck on legal", "blocked", "waiting for the legal text"],
    ]);
    expect(own.tasks.map((t) => t.title).sort()).toEqual([
      "Doing",
      "Look at this",
      "Send the logo",
      "Stuck on legal",
    ]);
    expect(own.shipped.map((t) => t.title)).toEqual(["Done one"]);
    expect(own.tasks.find((t) => t.title === "Send the logo")).toMatchObject({
      assignee: "person",
      assigneeUserId: C,
      canOpen: true,
    });
    // The person on the project reads the same work, without the flags, the notes or the pages of other people's tasks.
    const theirs = (await read(C, p.id)).body.project;
    expect(theirs.needsYou).toEqual([]);
    expect(theirs.health).toEqual({ state: "on_track", sentence: "1 in progress. 1 of 5 done." });
    expect(theirs.tasks.find((t) => t.id === blocked.id)).toMatchObject({
      progress: "",
      canOpen: false,
    });
    expect(theirs.tasks.find((t) => t.id === asked.id)?.canOpen).toBe(true);
    expect(theirs.rooms).toEqual([]);
    // A card of the owner about a task of the project counts once, with the card's words.
    const mineToDo = await tasks.ask(actor, {
      title: "Approve the budget",
      description: "The quote is 2k",
      assigneeUserId: A,
      projectId: p.id,
    });
    const after = (await read(A, p.id)).body.project;
    expect(after.needsYou.find((n) => n.taskId === mineToDo.id)).toMatchObject({
      why: "card",
      kind: "task_ask",
      text: "The quote is 2k",
    });
    expect(after.health.sentence).toBe("3 tasks are waiting on you. 1 of 6 done.");
    const list = await call<{
      projects: ProjectSummary[];
      unfiled: { total: number; open: number };
    }>(A, "GET", "/api/projects");
    expect(list.body.projects.find((x) => x.id === p.id)?.health.state).toBe("needs_you");
    expect(list.body.unfiled.total).toBeGreaterThan(0);
    expect(list.body.unfiled.open).toBeLessThanOrEqual(list.body.unfiled.total);
  });

  test("the manager asks a bot for something: the task exists at once and the bot is told", async () => {
    const p = await create("Asking", { bots: [painter], people: [C] });
    chatCalls.length = 0;
    const res = await call<{ task: { id: string; title: string }; conversationId: string }>(
      A,
      "POST",
      `/api/projects/${p.id}/work`,
      { to: { kind: "bot", id: painter }, text: "Draw the banner\nUse the brand colors." },
    );
    expect(res.status).toBe(201);
    const [row] = await db.select().from(taskTable).where(eq(taskTable.id, res.body.task.id));
    expect(row).toMatchObject({
      title: "Draw the banner",
      description: "Draw the banner\nUse the brand colors.",
      projectId: p.id,
      botId: painter,
      conversationId: res.body.conversationId,
      followUp: "auto",
      status: "backlog",
    });
    expect(row!.nextCheckAt).not.toBeNull();
    expect(chatCalls.map((c) => c.kind)).toEqual(["new", "turn"]);
    expect(chatCalls[1]!.content).toStartWith("Draw the banner\nUse the brand colors.\n\n");
    expect(chatCalls[1]!.content).toContain("“Draw the banner” in the project “Asking”");
    // A busy chat queues the message; the same chat is used again.
    chatState.busy = true;
    chatCalls.length = 0;
    const second = await call<{ conversationId: string }>(A, "POST", `/api/projects/${p.id}/work`, {
      to: { kind: "bot", id: painter },
      text: "And a favicon",
    });
    expect(chatCalls.map((c) => c.kind)).toEqual(["queue"]);
    expect(second.body.conversationId).toBe(res.body.conversationId);
    chatState.busy = false;
    // A turn that started in between is a busy chat too.
    chatState.fail = new TurnBusyError();
    chatCalls.length = 0;
    await call(A, "POST", `/api/projects/${p.id}/work`, {
      to: { kind: "bot", id: painter },
      text: "And a logo",
    });
    expect(chatCalls.map((c) => c.kind)).toEqual(["queue"]);
    // When the bot cannot be told, no task is left behind.
    chatState.fail = new AgentsPausedError();
    const before = (await read(A, p.id)).body.project.counts.total;
    const paused = await call(A, "POST", `/api/projects/${p.id}/work`, {
      to: { kind: "bot", id: painter },
      text: "Never told",
    });
    expect(paused.status).toBe(409);
    expect(paused.body.error?.message).toBe("Your agents are paused. Resume them first.");
    expect((await read(A, p.id)).body.project.counts.total).toBe(before);
    chatState.fail = undefined;
    // Only members of the project, and only its owner asks.
    expect(
      (
        await call(A, "POST", `/api/projects/${p.id}/work`, {
          to: { kind: "bot", id: scribe },
          text: "x",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(C, "POST", `/api/projects/${p.id}/work`, {
          to: { kind: "bot", id: painter },
          text: "x",
        })
      ).status,
    ).toBe(404);
  });

  test("the manager asks a person: they get the task and a card", async () => {
    const p = await create("Asking people", { people: [C] });
    const res = await call<{ task: { id: string }; conversationId: null }>(
      A,
      "POST",
      `/api/projects/${p.id}/work`,
      { to: { kind: "person", id: C }, text: "Send me the price list" },
    );
    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeNull();
    const [row] = await db.select().from(taskTable).where(eq(taskTable.id, res.body.task.id));
    expect(row).toMatchObject({
      title: "Send me the price list",
      assignee: "person",
      assigneeUserId: C,
      teamId,
      projectId: p.id,
      botId: null,
    });
    const theirs = await call<{ tasks: { id: string }[] }>(C, "GET", "/api/tasks");
    expect(theirs.body.tasks.map((t) => t.id)).toContain(res.body.task.id);
    expect(
      (
        await call(A, "POST", `/api/projects/${p.id}/work`, {
          to: { kind: "person", id: D },
          text: "x",
        })
      ).status,
    ).toBe(409);
  });

  test("a brief is drafted from one sentence, and a failure leaves the form usable", async () => {
    const ask = (body: object) =>
      call<{ kind: string; value?: Record<string, string>; reason?: string }>(
        A,
        "POST",
        "/api/projects/draft",
        body,
      );
    cliReply = `Here you go: {"outcome":"A page","audience":"New customers","doneWhen":"It is live","notIncluded":"","extra":1}`;
    const ok = await ask({ name: "Launch", sentence: "We need a launch page for new customers" });
    expect(ok.body).toEqual({
      kind: "ok",
      value: {
        outcome: "A page",
        audience: "New customers",
        doneWhen: "It is live",
        notIncluded: "",
      },
    });
    cliReply = "no json here";
    expect((await ask({ name: "Launch", sentence: "x" })).body.kind).toBe("unavailable");
    cliReply = "throw";
    expect((await ask({ name: "Launch", sentence: "x" })).body).toEqual({
      kind: "unavailable",
      reason: "The engine could not answer. Try again.",
    });
    // The stranger has no chief bot.
    expect(
      (await call<{ kind: string }>(B, "POST", "/api/projects/draft", { name: "n", sentence: "s" }))
        .body.kind,
    ).toBe("unavailable");
    expect((await ask({ name: "", sentence: "x" })).status).toBe(400);
  });

  test("every change tells the owner and the people on the project", async () => {
    told.length = 0;
    const p = await create("Telling", { people: [C] });
    await call(A, "PATCH", `/api/projects/${p.id}`, { watch: "close" });
    expect(told.length).toBe(2);
    for (const who of told) expect([...who].sort()).toEqual([A, C].sort());
    expect((await read(A, p.id)).body.project.watch).toBe("close");
  });
});

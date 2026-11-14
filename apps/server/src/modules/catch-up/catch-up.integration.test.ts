import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem, configProposal } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { task } from "@zetta/db/schema/tasks";
import type { CatchUpItem, CatchUpSummary } from "@zetta/core/catch-up";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createChatService } from "../chat/service";
import { createTaskStore } from "../tasks/store";
import { RoutineError } from "../features/routines";
import { createCatchUpActions } from "./act";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `cu-a-${uuidv7()}`;
const B = `cu-b-${uuidv7()}`;
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

suite("inbox queue", () => {
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
  const fakeRun = Object.assign(async () => ({ text: "done", stopped: false }), {
    stream: async function* () {
      yield "done";
    },
  });
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
      backgroundActor: (userId: string) =>
        issueBackgroundActor(async () => ({ isAdmin: false }) as never, userId),
    },
  );
  // Tasks are real; everything else records what it was asked, so a test can say which function ran and with what.
  const calls: string[] = [];
  let refuse: Error | undefined;
  const rec =
    (name: string, result: unknown = {}) =>
    async (_actor: unknown, ...args: unknown[]) => {
      if (refuse) throw refuse;
      calls.push(
        `${name}(${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(", ")})`,
      );
      return result;
    };
  const tasks = createTaskStore(db);
  const actions = createCatchUpActions({
    db,
    tasks,
    loops: { resumeWith: rec("loops.resumeWith") } as never,
    discussions: {
      postAsOwner: rec("room.post"),
      setStatus: rec("room.status", { conversationId: "conv-1" }),
    } as never,
    memory: {
      decide: async (...a: unknown[]) => calls.push(`memory.decide(${a.slice(1).join(", ")})`),
    } as never,
    chat: {
      sendMessage: rec("chat.send"),
      setLoop: rec("chat.setLoop"),
      cancelTurn: rec("chat.cancelTurn"),
    } as never,
    features: {
      routines: { runNow: rec("routine.run"), setPaused: rec("routine.setPaused") },
      routineTriggers: { setStatus: rec("trigger.setStatus") },
      workflows: { run: rec("workflow.run") },
    } as never,
    inbound: { setRoute: rec("inbound.setRoute") } as never,
  });
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    catchUp: { access, catchUp: { db, listProposals: chatSvc.listProposals }, actions },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const get = async (path: string, as = A) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, { headers: { "x-test-user": as } }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const post = async (path: string, body?: unknown, as = A) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method: "POST",
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
  const act = (id: string, body?: unknown, as = A) => post(`/api/catch-up/${id}/act`, body, as);
  const deny = (id: string, as = A) => post(`/api/catch-up/${id}/deny`, undefined, as);
  const queue = async (as = A, query = "") =>
    (await get(`/api/catch-up${query}`, as)).json.items as CatchUpItem[];

  const proposal = async (owner: string, expiresAt?: Date) => {
    const [row] = await db
      .insert(configProposal)
      .values({
        ownerUserId: owner,
        kind: "chief_action",
        baseVersion: 0,
        patch: { title: "Change something" },
        diff: [],
        resultLink: "/chat/somewhere",
        ...(expiresAt ? { expiresAt } : {}),
      })
      .returning();
    return row!.id;
  };
  const card = async (
    owner: string,
    kind: (typeof attentionItem.$inferInsert)["kind"],
    extra: Partial<typeof attentionItem.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(attentionItem)
      .values({ ownerUserId: owner, title: `A ${kind} card`, kind, source: "bot", ...extra })
      .returning();
    return row!.id;
  };
  const statusOfCard = async (id: string) =>
    (await db.select().from(attentionItem).where(eq(attentionItem.id, id)))[0]!.status;
  const clear = async () => {
    calls.length = 0;
    refuse = undefined;
    await db.delete(attentionItem).where(eq(attentionItem.ownerUserId, A));
    await db.delete(attentionItem).where(eq(attentionItem.ownerUserId, B));
    await db.delete(configProposal).where(eq(configProposal.ownerUserId, A));
    await db.delete(configProposal).where(eq(configProposal.ownerUserId, B));
    await db.delete(task).where(eq(task.ownerUserId, A));
  };

  beforeAll(async () => {
    const now = new Date();
    for (const id of [A, B]) {
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
    }
  });
  afterAll(async () => {
    await clear();
    await cleanupTestUsers(db, [A, B]);
  });

  test("a pending approval is in the queue with its link and confirm mode; an expired one is not", async () => {
    await clear();
    const live = await proposal(A);
    const gone = await proposal(A, hoursFromNow(-1));
    const items = await queue();
    const ids = items.map((i) => i.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(gone);
    const item = items.find((i) => i.id === live)!;
    expect(item.source).toBe("proposal");
    expect(item.key).toBe(`proposal:${live}`);
    expect(item.resultLink).toBe("/chat/somewhere");
    expect((item as { proposal: { confirm: string } }).proposal.confirm).toBe("click");
  });

  test("updates and the legacy proposal cards never enter the queue", async () => {
    await clear();
    await card(A, "room_idle");
    await card(A, "memory_updated");
    await card(A, "turn_slow");
    await card(A, "background_done");
    await card(A, "proposal", { sourceKey: `proposal:${uuidv7()}` });
    expect(await queue()).toEqual([]);
  });

  test("a decision card whose task is still waiting shows what it is about", async () => {
    await clear();
    const [t] = await db
      .insert(task)
      .values({ ownerUserId: A, title: "Pick a vendor", assignee: "person", assigneeUserId: A })
      .returning();
    const id = await card(A, "task_ask", { subjectId: t!.id });
    const [item] = await queue();
    expect(item).toMatchObject({ source: "card", id, kind: "task_ask" });
    const c = item as Extract<CatchUpItem, { source: "card" }>;
    expect(c.context).toMatchObject({ subject: "Pick a vendor", status: "backlog" });
    expect(c.actions.actLabel).toBe("Done");
    expect(c.actions.denyLabel).toBe("Won't do");
  });

  test("a card closes by itself once its task is done or gone, and leaves the queue", async () => {
    await clear();
    const [done] = await db
      .insert(task)
      .values({ ownerUserId: A, title: "Already done", status: "done" })
      .returning();
    const doneCard = await card(A, "task_ask", { subjectId: done!.id });
    const missingCard = await card(A, "task_ask", { subjectId: uuidv7() });
    expect(await queue()).toEqual([]);
    expect(await statusOfCard(doneCard)).toBe("resolved");
    expect(await statusOfCard(missingCard)).toBe("resolved");
  });

  test("a card of a kind that cannot be checked stays until someone acts", async () => {
    await clear();
    const id = await card(A, "sign_in");
    expect((await queue()).map((i) => i.id)).toEqual([id]);
    expect(await statusOfCard(id)).toBe("open");
  });

  test("the approval that expires first comes first, then the oldest card", async () => {
    await clear();
    const later = await proposal(A, hoursFromNow(20));
    const sooner = await proposal(A, hoursFromNow(2));
    const olderCard = await card(A, "sign_in", { createdAt: new Date(Date.now() - 86_400_000) });
    const newerCard = await card(A, "bot_ask");
    expect((await queue()).map((i) => i.id)).toEqual([sooner, later, olderCard, newerCard]);
  });

  test("?bot= keeps only what that bot asked; a bad id is refused", async () => {
    await clear();
    await proposal(A);
    await card(A, "sign_in");
    expect(await queue()).toHaveLength(2);
    expect(await queue(A, `?bot=${uuidv7()}`)).toEqual([]);
    expect((await get("/api/catch-up?bot=not-a-uuid")).status).toBe(400);
  });

  test("nobody sees another person's approvals or cards", async () => {
    await clear();
    await proposal(B);
    await card(B, "sign_in");
    expect(await queue(A)).toEqual([]);
    expect(await queue(B)).toHaveLength(2);
  });

  test("the summary counts exactly what the list holds", async () => {
    await clear();
    await proposal(A);
    await card(A, "sign_in");
    await card(A, "room_idle");
    const summary = (await get("/api/catch-up/summary")).json as CatchUpSummary;
    expect(summary.count).toBe((await queue()).length);
    expect(summary.count).toBe(2);
    expect(summary.byBot).toEqual({});
  });

  test("Act on a task question marks the task done and closes the card", async () => {
    await clear();
    const [t] = await db
      .insert(task)
      .values({ ownerUserId: A, title: "Pick a vendor", assignee: "person", assigneeUserId: A })
      .returning();
    const id = await card(A, "task_ask", { subjectId: t!.id });
    expect((await act(id)).status).toBe(200);
    expect((await db.select().from(task).where(eq(task.id, t!.id)))[0]!.status).toBe("done");
    expect(await statusOfCard(id)).toBe("resolved");
    expect(await queue()).toEqual([]);
  });

  test("an answer to a task question needs a chat to go to, and the card stays if there is none", async () => {
    await clear();
    const [t] = await db.insert(task).values({ ownerUserId: A, title: "No chat" }).returning();
    const id = await card(A, "task_ask", { subjectId: t!.id });
    const r = await act(id, { text: "Go with the cheaper one" });
    expect(r.status).toBe(400);
    expect(r.json.error?.code ?? r.json.code).toBe("UNSUPPORTED");
    expect(await statusOfCard(id)).toBe("open");
    expect((await db.select().from(task).where(eq(task.id, t!.id)))[0]!.status).toBe("backlog");
  });

  test("Deny on a task question removes the task and cancels the card", async () => {
    await clear();
    const [t] = await db
      .insert(task)
      .values({ ownerUserId: A, title: "Not doing this" })
      .returning();
    const id = await card(A, "task_ask", { subjectId: t!.id });
    expect((await deny(id)).status).toBe(200);
    expect(await db.select().from(task).where(eq(task.id, t!.id))).toEqual([]);
    expect(await statusOfCard(id)).toBe("cancelled");
  });

  test("a paused follow-up resumes on Act and stops on Deny", async () => {
    await clear();
    const mk = async () => {
      const [t] = await db
        .insert(task)
        .values({
          ownerUserId: A,
          title: "Keep an eye on it",
          followUp: "paused",
          status: "in_progress",
        })
        .returning();
      return { taskId: t!.id, card: await card(A, "task_follow", { subjectId: t!.id }) };
    };
    const resume = await mk();
    expect((await act(resume.card)).status).toBe(200);
    expect((await db.select().from(task).where(eq(task.id, resume.taskId)))[0]!.followUp).toBe(
      "auto",
    );
    const stop = await mk();
    expect((await deny(stop.card)).status).toBe(200);
    expect((await db.select().from(task).where(eq(task.id, stop.taskId)))[0]!.followUp).toBe("off");
  });

  test("a paused loop resumes on Act and is stopped on Deny", async () => {
    await clear();
    const loopId = uuidv7();
    const a = await card(A, "loop_paused", { subjectId: loopId });
    await act(a);
    expect(calls).toEqual([`chat.setLoop(${loopId}, running)`]);
    calls.length = 0;
    const d = await card(A, "loop_paused", { subjectId: loopId });
    await deny(d);
    expect(calls).toEqual([`chat.setLoop(${loopId}, cancelled)`]);
    expect(await statusOfCard(a)).toBe("resolved");
    expect(await statusOfCard(d)).toBe("cancelled");
  });

  test("a stuck room needs a message to nudge; Deny cancels it and stops its turns", async () => {
    await clear();
    const roomId = uuidv7();
    const id = await card(A, "room_stuck", { subjectId: roomId });
    const empty = await act(id);
    expect(empty.status).toBe(400);
    expect(calls).toEqual([]);
    expect(await statusOfCard(id)).toBe("open");
    expect((await act(id, { text: "Try the other approach" })).status).toBe(200);
    expect(calls).toEqual([`room.post(${roomId}, Try the other approach)`]);
    const again = await card(A, "room_stuck", { subjectId: roomId });
    calls.length = 0;
    await deny(again);
    expect(calls).toEqual([`room.status(${roomId}, cancel)`, "chat.cancelTurn(conv-1)"]);
  });

  test("a failed routine runs again on Act (once per card) and pauses on Deny", async () => {
    await clear();
    const routineId = uuidv7();
    const a = await card(A, "routine_failed", { subjectId: routineId });
    await act(a);
    expect(calls).toEqual([`routine.run(${routineId}, catch-up:${a}, background)`]);
    calls.length = 0;
    const d = await card(A, "routine_failed", { subjectId: routineId });
    await deny(d);
    expect(calls).toEqual([`routine.setPaused(${routineId}, true)`]);
  });

  test("a kind that takes no message refuses one", async () => {
    await clear();
    const id = await card(A, "routine_failed", { subjectId: uuidv7() });
    expect((await act(id, { text: "please" })).status).toBe(400);
    expect(calls).toEqual([]);
    expect(await statusOfCard(id)).toBe("open");
  });

  test("when the domain refuses, the person is told why and the card stays", async () => {
    await clear();
    const id = await card(A, "routine_blocked", { subjectId: uuidv7() });
    refuse = new RoutineError("NOT_READY", ["a Gmail connection"]);
    const r = await act(id);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.json)).toContain("a Gmail connection");
    expect(await statusOfCard(id)).toBe("open");
    refuse = undefined;
    expect((await act(id)).status).toBe(200);
    expect(await statusOfCard(id)).toBe("resolved");
  });

  test("a lost connection is reconnected in the browser: Act is refused, Deny dismisses", async () => {
    await clear();
    const id = await card(A, "connection_lost", { sourceKey: "knowledge-sync:auth" });
    const r = await act(id);
    expect(r.status).toBe(400);
    expect(await statusOfCard(id)).toBe("open");
    expect((await deny(id)).status).toBe(200);
    expect(await statusOfCard(id)).toBe("cancelled");
    expect(calls).toEqual([]);
  });

  test("cards that only point somewhere close without running anything", async () => {
    await clear();
    const id = await card(A, "sign_in");
    expect((await act(id)).status).toBe(200);
    expect(await statusOfCard(id)).toBe("resolved");
    expect(calls).toEqual([]);
  });

  test("a failed workflow starts again with no input, once for this card", async () => {
    await clear();
    const wf = uuidv7();
    const id = await card(A, "workflow_failed", { subjectId: wf });
    expect((await act(id)).status).toBe(200);
    expect(calls).toEqual([`workflow.run(${wf}, , catch-up:${id})`]);
  });

  test("someone else's card, a closed card and a made-up id are all not found", async () => {
    await clear();
    const mine = await card(A, "sign_in");
    expect((await act(mine, undefined, B)).status).toBe(404);
    expect((await deny(mine, B)).status).toBe(404);
    expect(await statusOfCard(mine)).toBe("open");
    await act(mine);
    expect((await act(mine)).status).toBe(404);
    expect((await act(uuidv7())).status).toBe(404);
    // An update card is not a decision: it can not be acted on here.
    const update = await card(A, "room_idle");
    expect((await act(update)).status).toBe(404);
  });

  test("it needs a signed-in person", async () => {
    const r = await app.handle(new Request("http://localhost/api/catch-up"));
    expect(r.status).toBe(401);
  });
});

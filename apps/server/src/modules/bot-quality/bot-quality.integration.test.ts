import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { auditEvent, messageFeedback } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { skillReview } from "@zetta/db/schema/skills";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createLoopStore } from "../chat/loops";
import { createChatService } from "../chat/service";
import { createDiscussionStore } from "../discussions/store";
import { createIdentityAccess } from "../identity/access";
import { createSkillReview } from "../memory/skill-review";
import { createSkills } from "../skills/service";
import { createTaskStore } from "../tasks/store";
import { createBotQuality } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`bq-a-${uuidv7()}`, `bq-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("bot quality: ratings, numbers, saved tests and version history", () => {
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
  let reply = "Here is the answer.";
  const asked: string[] = [];
  const fakeRun = Object.assign(
    async (t: { prompt: string }) => {
      asked.push(t.prompt);
      return { text: reply, stopped: false };
    },
    {
      stream: async function* (t: { prompt: string }) {
        asked.push(t.prompt);
        yield reply;
      },
    },
  );
  const tasks = createTaskStore(db);
  const discussions = createDiscussionStore(db, undefined, createLoopStore(db));
  const reviewCli: string[] = [];
  const skills = createSkills(db);
  const review = createSkillReview(db, skills, {
    cli: async (i) => {
      reviewCli.push(i.prompt);
      return '{"action":"none"}';
    },
  });
  let app: ReturnType<typeof createApp>;
  let svc: ReturnType<typeof createChatService>;
  let quality: ReturnType<typeof createBotQuality>;

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
    svc = createChatService(
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
      { tasks, discussions },
    );
    quality = createBotQuality(db, { chat: svc, skillReview: review });
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: { access, chat: svc },
      botQuality: { access, quality },
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

  /** A bot (through the API, so it has a first revision) on the scripted engine, with a chat that holds one answer. */
  async function botWithAnswer(owner: string, over: Record<string, unknown> = {}) {
    const made = (await call(owner, "POST", "/api/bots", { name: `Q ${uuidv7().slice(-6)}` })).json
      .bot as { id: string; version: number };
    const done = (
      await call(owner, "PATCH", `/api/bots/${made.id}`, {
        expectedVersion: made.version,
        patch: { harness: "codex", instructions: "Be brief.", ...over },
      })
    ).json.bot as { id: string; version: number };
    const [conv] = await db
      .insert(conversation)
      .values({ ownerUserId: owner, botId: done.id, title: "t" } as never)
      .returning();
    const [user1] = await db
      .insert(message)
      .values({
        conversationId: conv!.id,
        ownerUserId: owner,
        seq: 1,
        role: "user",
        content: "Summarise the report",
        status: "complete",
      } as never)
      .returning();
    const [answer] = await db
      .insert(message)
      .values({
        conversationId: conv!.id,
        ownerUserId: owner,
        seq: 2,
        role: "assistant",
        content: "Done: three points.",
        status: "complete",
        botId: done.id,
        botVersion: done.version,
      } as never)
      .returning();
    return { bot: done, conv: conv!, userMsg: user1!, answer: answer! };
  }

  test("a person rates an answer; a new rating replaces the old one and only a thumb down keeps its reason", async () => {
    const { answer, conv } = await botWithAnswer(A);
    const up = await call(A, "PUT", `/api/messages/${answer.id}/feedback`, {
      rating: "up",
      reason: "ignored for a thumb up",
    });
    expect(up.json.feedback).toEqual({ messageId: answer.id, rating: "up", reason: "" });
    const down = await call(A, "PUT", `/api/messages/${answer.id}/feedback`, {
      rating: "down",
      reason: "Too long",
    });
    expect(down.json.feedback).toMatchObject({ rating: "down", reason: "Too long" });
    expect(
      await db.select().from(messageFeedback).where(eq(messageFeedback.messageId, answer.id)),
    ).toHaveLength(1);
    expect(
      (await call(A, "GET", `/api/conversations/${conv.id}/feedback`)).json.feedback[answer.id],
    ).toEqual({ rating: "down", reason: "Too long" });
    expect((await call(A, "DELETE", `/api/messages/${answer.id}/feedback`)).json).toEqual({
      cleared: true,
    });
    expect((await call(A, "GET", `/api/conversations/${conv.id}/feedback`)).json.feedback).toEqual(
      {},
    );
  });

  test("only the owner's answer of a bot can be rated: not a question, not somebody else's, not a reason that is too long", async () => {
    const { answer, userMsg } = await botWithAnswer(A);
    expect(
      (await call(A, "PUT", `/api/messages/${userMsg.id}/feedback`, { rating: "up" })).status,
    ).toBe(404);
    expect(
      (await call(B, "PUT", `/api/messages/${answer.id}/feedback`, { rating: "up" })).status,
    ).toBe(404);
    expect(
      (
        await call(A, "PUT", `/api/messages/${answer.id}/feedback`, {
          rating: "down",
          reason: "x".repeat(501),
        })
      ).status,
    ).toBe(400);
    expect(
      (await call(A, "PUT", `/api/messages/${answer.id}/feedback`, { rating: "meh" })).status,
    ).toBe(400);
  });

  test("a thumb down on a skill-learning bot queues a review that carries what the person wrote", async () => {
    const { answer, bot: b } = await botWithAnswer(A, {
      harness: "claude-code",
      autoLearn: "auto",
    });
    await call(A, "PUT", `/api/messages/${answer.id}/feedback`, {
      rating: "down",
      reason: "Never answer in bullets",
    });
    await Bun.sleep(150);
    const [row] = await db.select().from(skillReview).where(eq(skillReview.replyId, answer.id));
    expect(row).toMatchObject({
      reason: "downvoted",
      botId: b.id,
      status: "pending",
      detail: "Never answer in bullets",
    });
    expect(await review.tick()).toBeGreaterThanOrEqual(1);
    expect(reviewCli.at(-1)).toContain(
      "MARKED THE LAST ASSISTANT REPLY AS BAD AND WROTE: Never answer in bullets",
    );
    // A thumb up, or a bot with autolearn off, queues nothing.
    const off = await botWithAnswer(A, { harness: "claude-code", autoLearn: "off" });
    await call(A, "PUT", `/api/messages/${off.answer.id}/feedback`, { rating: "down" });
    await Bun.sleep(100);
    expect(
      await db.select().from(skillReview).where(eq(skillReview.replyId, off.answer.id)),
    ).toEqual([]);
  });

  test("the numbers count runs, failures, how long they took and how often the person stepped in", async () => {
    const { bot: b, answer } = await botWithAnswer(A);
    const run = (outcome: "ok" | "failed" | "cancelled", durationMs: number | null) =>
      db
        .insert(auditEvent)
        .values({ ownerUserId: A, kind: "harness_run", outcome, botId: b.id, durationMs } as never);
    for (const d of [1000, 2000, 3000, 4000, 10_000]) await run("ok", d);
    await run("failed", 500);
    await run("cancelled", null);
    await db.insert(message).values({
      conversationId: answer.conversationId,
      ownerUserId: A,
      seq: 9,
      role: "assistant",
      content: "x",
      status: "cancelled",
      botId: b.id,
    } as never);
    await call(A, "PUT", `/api/messages/${answer.id}/feedback`, { rating: "up" });
    const s = (await call(A, "GET", `/api/bots/${b.id}/stats?days=7`)).json.stats;
    expect(s.runs).toEqual({ total: 7, ok: 5, cancelled: 1, failed: 1 });
    expect(s.duration).toMatchObject({ medianMs: 2500, samples: 6 });
    expect(s.duration.p90Ms).toBeGreaterThan(4000);
    expect(s.stepIn.cancelledReplies).toBe(1);
    expect(s.feedback).toEqual({ up: 1, down: 0 });
    expect((await call(A, "GET", `/api/bots/${b.id}/stats?days=30`)).status).toBe(200);
    expect((await call(A, "GET", `/api/bots/${b.id}/stats?days=3`)).status).toBe(400);
    // Another person cannot read them.
    expect((await call(B, "GET", `/api/bots/${b.id}/stats`)).status).toBe(404);
  });

  test("saved tests: add, edit, limit and remove; running them uses the bot as it is now, in chats the person never sees", async () => {
    const { bot: b } = await botWithAnswer(A);
    const add = (title: string) =>
      call(A, "POST", `/api/bots/${b.id}/drive/prompts`, { title, prompt: `Question ${title}` });
    const first = (await add("Greeting")).json.prompt as { id: string };
    expect(
      (
        await call(A, "PATCH", `/api/bots/${b.id}/drive/prompts/${first.id}`, {
          title: "Hello",
          prompt: "Say hello in one line",
        })
      ).json.prompt.title,
    ).toBe("Hello");
    for (let i = 1; i < 10; i++) expect((await add(`T${i}`)).status).toBe(201);
    expect((await add("one too many")).status).toBe(409);
    expect(
      (await call(B, "POST", `/api/bots/${b.id}/drive/prompts`, { title: "x", prompt: "y" }))
        .status,
    ).toBe(404);
    // Remove all but the first so the run is quick.
    const list = (await call(A, "GET", `/api/bots/${b.id}/drive`)).json;
    expect(list.limit).toBe(10);
    for (const p of list.prompts.slice(1))
      await call(A, "DELETE", `/api/bots/${b.id}/drive/prompts/${p.id}`);

    reply = "Hello there!";
    asked.length = 0;
    const started = await call(A, "POST", `/api/bots/${b.id}/drive/run`, {});
    expect(started.status).toBe(202);
    expect(started.json).toMatchObject({ started: 1, botVersion: b.version });
    // While it runs, a second run is refused.
    expect((await call(A, "POST", `/api/bots/${b.id}/drive/run`, {})).status).toBe(409);
    let done: any;
    for (let i = 0; i < 100; i++) {
      done = (await call(A, "GET", `/api/bots/${b.id}/drive`)).json.prompts[0].runs[0];
      if (done && done.status !== "running") break;
      await Bun.sleep(50);
    }
    expect(done).toMatchObject({ status: "done", botVersion: b.version, answer: "Hello there!" });
    expect(asked.join("\n")).toContain("Say hello in one line");
    // The chat of a test is in no list and in no search.
    const chats = (await call(A, "GET", `/api/conversations?botId=${b.id}`)).json.conversations as {
      id: string;
    }[];
    expect(chats.some((c) => c.id === done.conversationId)).toBe(false);

    // After a change to the bot, running again records the new version next to the old one.
    const bumped = (
      await call(A, "PATCH", `/api/bots/${b.id}`, {
        expectedVersion: b.version,
        patch: { instructions: "Be warm." },
      })
    ).json.bot;
    reply = "Hello, friend!";
    expect(
      (await call(A, "POST", `/api/bots/${b.id}/drive/run`, { promptId: first.id })).json
        .botVersion,
    ).toBe(bumped.version);
    let runs: any[] = [];
    for (let i = 0; i < 100; i++) {
      runs = (await call(A, "GET", `/api/bots/${b.id}/drive`)).json.prompts[0].runs;
      if (runs.length === 2 && runs[0].status !== "running") break;
      await Bun.sleep(50);
    }
    expect(runs.map((r) => [r.botVersion, r.answer])).toEqual([
      [bumped.version, "Hello, friend!"],
      [b.version, "Hello there!"],
    ]);
  });

  test("a bot with no engine that writes answers has nothing to compare", async () => {
    const { bot: b } = await botWithAnswer(A, { harness: "fixture" });
    await call(A, "POST", `/api/bots/${b.id}/drive/prompts`, { title: "x", prompt: "y" });
    expect((await call(A, "POST", `/api/bots/${b.id}/drive/run`, {})).status).toBe(400);
  });

  test("the chat memory settings are part of a version: History lists them and a restore brings them back", async () => {
    const made = (await call(A, "POST", "/api/bots", { name: `Memory ${Date.now().toString(36)}` }))
      .json.bot as { id: string; version: number };
    const tuned = (
      await call(A, "PATCH", `/api/bots/${made.id}`, {
        expectedVersion: made.version,
        patch: {
          contextBytes: 50_000,
          summaryMode: "bot",
          summaryMaxChars: 4000,
          summaryGapBytes: 9000,
          chatSearchLimit: 3,
        },
      })
    ).json.bot;
    const reset = (
      await call(A, "PATCH", `/api/bots/${made.id}`, {
        expectedVersion: tuned.version,
        patch: {
          contextBytes: null,
          summaryMode: "off",
          summaryMaxChars: null,
          summaryGapBytes: null,
          chatSearchLimit: null,
        },
      })
    ).json.bot;
    const hist = (await call(A, "GET", `/api/bots/${made.id}/revisions`)).json;
    expect(hist.revisions[0].changed).toEqual(
      expect.arrayContaining([
        "contextBytes",
        "summaryMode",
        "summaryMaxChars",
        "summaryGapBytes",
        "chatSearchLimit",
      ]),
    );
    const back = await call(A, "POST", `/api/bots/${made.id}/revisions/${tuned.version}/restore`, {
      expectedVersion: reset.version,
    });
    expect(back.status).toBe(200);
    const after = ((await call(A, "GET", "/api/bots")).json.bots as Record<string, unknown>[]).find(
      (x) => x.id === made.id,
    )!;
    expect(after).toMatchObject({
      contextBytes: 50_000,
      summaryMode: "bot",
      summaryMaxChars: 4000,
      summaryGapBytes: 9000,
      chatSearchLimit: 3,
    });
  });

  test("version history lists what changed, restores an old version as a new one, and refuses what it cannot", async () => {
    const { bot: b } = await botWithAnswer(A, { instructions: "Version one text." });
    const v2 = (
      await call(A, "PATCH", `/api/bots/${b.id}`, {
        expectedVersion: b.version,
        patch: { instructions: "Version two text.", autoLearn: "suggest" },
      })
    ).json.bot;
    const hist = (await call(A, "GET", `/api/bots/${b.id}/revisions`)).json;
    expect(hist.revisions[0]).toMatchObject({ version: v2.version, current: true });
    expect(hist.revisions[0].changed).toEqual(
      expect.arrayContaining(["instructions", "autoLearn"]),
    );
    expect(hist.revisions[0].config.autoLearn).toBe("suggest");

    const back = await call(A, "POST", `/api/bots/${b.id}/revisions/${b.version}/restore`, {
      expectedVersion: v2.version,
    });
    expect(back.status).toBe(200);
    expect(back.json.version).toBe(v2.version + 1);
    const after = (
      (await call(A, "GET", "/api/bots")).json.bots as {
        id: string;
        instructions: string;
        version: number;
      }[]
    ).find((x) => x.id === b.id)!;
    expect(after.instructions).toBe("Version one text.");
    expect(after.version).toBe(v2.version + 1);
    // History is never rewound: the restore is a version of its own.
    const hist2 = (await call(A, "GET", `/api/bots/${b.id}/revisions`)).json;
    expect(hist2.revisions.map((r: { version: number }) => r.version)).toContain(v2.version);
    expect(hist2.revisions[0].version).toBe(v2.version + 1);

    expect(
      (
        await call(A, "POST", `/api/bots/${b.id}/revisions/${v2.version + 1}/restore`, {
          expectedVersion: v2.version + 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(A, "POST", `/api/bots/${b.id}/revisions/99/restore`, {
          expectedVersion: v2.version + 1,
        })
      ).status,
    ).toBe(404);
    expect((await call(B, "GET", `/api/bots/${b.id}/revisions`)).status).toBe(404);
    expect(
      (
        await call(B, "POST", `/api/bots/${b.id}/revisions/${b.version}/restore`, {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(404);
  });

  test("the numbers and history of a bot that is not yours are not found", async () => {
    const { bot: b } = await botWithAnswer(A);
    for (const path of [
      `/api/bots/${b.id}/drive`,
      `/api/bots/${b.id}/stats`,
      `/api/bots/${b.id}/revisions`,
    ])
      expect((await call(B, "GET", path)).status).toBe(404);
    expect(await db.select().from(bot).where(eq(bot.id, b.id))).toHaveLength(1);
  });
});

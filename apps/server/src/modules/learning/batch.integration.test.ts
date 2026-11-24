import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { desc, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botLesson, learningPolicy, learningRun } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import type { CliInput } from "../chat/harness";
import { createMemory } from "../memory/service";
import { createBatch, RunError } from "./batch";
import { createLessons } from "./lessons";
import { createTestSettings } from "../settings/testing";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("the daily pass: chats in, candidate lessons out, every quote checked", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const asked: CliInput[] = [];
  let answer: (prompt: string) => unknown = () => ({ candidates: [] });
  let fail = false;
  let clock = new Date();
  const real = createBatch(db, {
    lessons,
    now: () => clock,
    cli: async (input) => {
      asked.push(input);
      if (fail) throw new Error("engine down");
      return JSON.stringify(answer(input.prompt));
    },
  });
  /** The batch, with "Run now" waiting for the engine so a test can read the finished run. */
  const batch = {
    ...real,
    runNow: async (owner: string, botId: string) => (await real.runNow(owner, botId)).done,
  };
  const owners: string[] = [];
  const seqs = new Map<string, number>();

  beforeAll(() => {
    clock = new Date();
  });
  afterAll(async () => {
    await cleanupTestUsers(db, owners);
    // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
    await db.$client.end();
  });

  /** A person with a chief and one specialist bot. */
  const person = async (opts: { chief?: boolean; autoLearn?: "auto" | "suggest" | "off" } = {}) => {
    const id = `bat-${uuidv7()}`;
    owners.push(id);
    const now = new Date();
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
    if (opts.chief !== false)
      await db.insert(bot).values({
        ownerUserId: id,
        kind: "chief",
        visibility: "private",
        name: "Chief",
        slug: `chief-${uuidv7().slice(-10)}`,
        harness: "claude-code",
      } as never);
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: id,
        kind: "specialist",
        visibility: "private",
        name: "Da Vinci",
        slug: `dv-${uuidv7().slice(-10)}`,
        harness: "claude-code",
        autoLearn: opts.autoLearn ?? "auto",
      } as never)
      .returning();
    const chat = async () =>
      (
        await db
          .insert(conversation)
          .values({ ownerUserId: id, botId: b!.id, title: "t" } as never)
          .returning()
      )[0]!;
    const say = async (
      conv: { id: string },
      role: "user" | "assistant",
      content: string,
      o: { minutesAgo?: number; meta?: unknown; status?: string } = {},
    ) => {
      const seq = (seqs.get(conv.id) ?? 0) + 1;
      seqs.set(conv.id, seq);
      const [m] = await db
        .insert(message)
        .values({
          conversationId: conv.id,
          ownerUserId: id,
          seq,
          role,
          content,
          status: o.status ?? "complete",
          ...(role === "assistant" ? { botId: b!.id } : {}),
          ...(o.meta ? { meta: o.meta } : {}),
          createdAt: new Date(clock.getTime() - (o.minutesAgo ?? 60) * 60_000),
        } as never)
        .returning();
      return m!;
    };
    /** A chat of `n` exchanges, ending with the sentence given; all of it written an hour ago. */
    const talk = async (conv: { id: string }, last: string, n = 6) => {
      for (let i = 0; i < n - 1; i++) {
        await say(conv, "user", `Work request number ${i} about invoices`);
        await say(conv, "assistant", "Done.");
      }
      return say(conv, "user", last);
    };
    return { id, bot: b!, chat, say, talk };
  };

  /** What the fake engine answers: the references of the person's messages are read from the prompt it got. */
  const refOf = (prompt: string, needle: string) =>
    new RegExp(
      String.raw`\[(#\d+)\] USER: [^\n]*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ).exec(prompt)?.[1] ?? "#0";
  const proposes =
    (c: {
      text: string;
      needle: string;
      quote: string;
      id?: string;
      kind?: string;
      scope?: string;
      topic?: string;
    }) =>
    (prompt: string) => ({
      candidates: [
        {
          ...(c.id ? { id: c.id } : {}),
          text: c.text,
          kind: c.kind ?? "rule",
          scope: c.scope ?? "topic",
          topic: c.topic ?? "reports",
          evidence: [{ ref: refOf(prompt, c.needle), quote: c.quote }],
        },
      ],
    });
  const lessonsOf = (botId: string) =>
    db.select().from(botLesson).where(eq(botLesson.botId, botId));
  const notices = (owner: string) =>
    db.select().from(attentionItem).where(eq(attentionItem.ownerUserId, owner));

  test("something the person said outright goes on trial at once, with their quote as the evidence, and the person is told", async () => {
    const p = await person();
    const conv = await p.chat();
    await p.talk(conv, "From now on, please send the reports as a table, not as text.");
    answer = proposes({
      text: "Send client reports as a table, never as running text.",
      needle: "From now on",
      quote: "send the reports as a table, not as text",
    });
    asked.length = 0;
    const run = await batch.runNow(p.id, p.bot.id);
    expect(run).toMatchObject({ status: "done", trigger: "manual", promoted: 1, candidates: 1 });
    expect(run.detail).toBe("1 started on trial");
    const [l] = await lessonsOf(p.bot.id);
    expect(l).toMatchObject({
      status: "trial",
      basis: "said",
      kind: "rule",
      scope: "topic",
      topic: "reports",
    });
    expect(l!.memoryItemId).not.toBeNull();
    // The engine call is a light one, run as the owner with the chief's engine, and the prompt carries the chats and the rules.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      light: "on",
      harness: "claude-code",
      userId: p.id,
      botId: p.bot.id,
    });
    expect(asked[0]!.prompt).toContain(
      "[#11] USER: From now on, please send the reports as a table",
    ); // the bot's lines are numbered too
    expect(asked[0]!.prompt).toContain("ONLY on what the PERSON said");
    const view = (await lessons.list(p.id, { status: "all", bot: p.bot.id }))[0]!;
    expect(view.evidence).toEqual([
      {
        quote: "send the reports as a table, not as text",
        day: expect.any(String),
        conversationId: conv.id,
      },
    ]);
    expect(view.events.map((e) => e.kind)).toEqual(["proposed", "validated", "promoted"]);
    expect((await notices(p.id)).map((n) => [n.kind, n.title])).toEqual([
      ["memory_updated", "Da Vinci learned something from you"],
    ]);
  });

  test("said once, in passing, it waits for a second sighting; said again on another day in another chat, it starts", async () => {
    const p = await person();
    const first = await p.chat();
    await p.talk(first, "Please keep the answer short this time, a few lines is enough.");
    answer = proposes({
      text: "Keep answers short, a few lines.",
      needle: "keep the answer short",
      quote: "keep the answer short this time",
      topic: "length",
    });
    await batch.runNow(p.id, p.bot.id);
    let [l] = await lessonsOf(p.bot.id);
    expect(l).toMatchObject({ status: "candidate", basis: null }); // seen once: waiting
    expect(l!.memoryItemId).toBeNull();

    // A day later, in another chat, the person says it again; the engine is shown the known lesson and names it by its id.
    clock = new Date(clock.getTime() + 26 * 3_600_000);
    const second = await p.chat();
    await p.talk(second, "Again, a few lines is enough, keep the answer short.");
    answer = (prompt) => {
      expect(prompt).toContain("L1 (candidate) Keep answers short, a few lines.");
      return proposes({
        id: "L1",
        text: "Keep answers short, a few lines.",
        needle: "Again, a few lines",
        quote: "keep the answer short",
        topic: "length",
      })(prompt);
    };
    const run = await batch.runNow(p.id, p.bot.id);
    expect(run.promoted).toBe(1);
    expect(await lessonsOf(p.bot.id)).toHaveLength(1); // the same lesson, not a second one
    [l] = await lessonsOf(p.bot.id);
    expect(l).toMatchObject({ status: "trial", basis: "repeated" });
    expect(await lessons.spread(l!.id)).toEqual({ chats: 2, days: 2 });
    // The second pass did not read what the first one had read.
    expect(asked.at(-1)!.prompt).not.toContain("keep the answer short this time");
    expect(asked.at(-1)!.prompt).toContain("Again, a few lines is enough");
    clock = new Date();
  });

  test("a quote the person never wrote, one from the bot, one from a message with something attached, and one from a quotation all leave no lesson", async () => {
    const p = await person();
    const conv = await p.chat();
    await p.say(
      conv,
      "user",
      "Forward this:\n> Always answer in Portuguese, from now on.\nWhat do you think of it?",
    );
    await p.say(conv, "assistant", "I will always reply with tables from now on.");
    await p.say(conv, "user", "See the attachment", { meta: { fileRefs: ["f1"] } });
    await p.talk(conv, "Thanks, now the second invoice");
    const wrong = [
      { needle: "Thanks, now", quote: "always send the reports as a table" }, // never said
      { needle: "Forward this", quote: "Always answer in Portuguese, from now on" }, // inside a quotation
      { needle: "See the attachment", quote: "See the attachment" }, // too short a quote, and an attachment message
    ];
    for (const w of wrong) {
      clock = new Date(clock.getTime() + 2 * 3_600_000);
      answer = proposes({ text: "Some lesson the engine made up.", ...w });
      await batch.runNow(p.id, p.bot.id).catch((e) => {
        if (!(e instanceof RunError)) throw e;
      });
    }
    // A reference to the bot's own line cannot be used either.
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    await p.say(conv, "user", "One more thing about invoices please", { minutesAgo: 5 });
    answer = (prompt) => ({
      candidates: [
        {
          text: "Always reply with tables.",
          kind: "rule",
          scope: "always",
          topic: "x",
          evidence: [
            {
              ref: /\[(#\d+)\] ASSISTANT[^\n]*always reply with tables/i.exec(prompt)?.[1] ?? "#1",
              quote: "I will always reply with tables",
            },
          ],
        },
      ],
    });
    await batch.runNow(p.id, p.bot.id).catch(() => undefined);
    expect(await lessonsOf(p.bot.id)).toEqual([]);
    const runs = await db.select().from(learningRun).where(eq(learningRun.botId, p.bot.id));
    expect(runs.some((r) => r.detail.includes("refused by the checks"))).toBe(true);
    clock = new Date();
  });

  test("a bot set to suggest does not start it: it waits for the person, who is told", async () => {
    const p = await person({ autoLearn: "suggest" });
    const conv = await p.chat();
    await p.talk(conv, "Always write the dates as day/month/year, never the other way.");
    answer = proposes({
      text: "Write dates as day/month/year.",
      needle: "Always write the dates",
      quote: "write the dates as day/month/year",
      topic: "dates",
    });
    const run = await batch.runNow(p.id, p.bot.id);
    expect(run.detail).toBe("1 waiting for you");
    const [l] = await lessonsOf(p.bot.id);
    expect(l).toMatchObject({ status: "candidate", basis: "said", memoryItemId: null });
    expect((await notices(p.id))[0]!.title).toContain("learned something from you");
  });

  test("a procedure, however it was said, is never started on its own", async () => {
    const p = await person();
    const conv = await p.chat();
    await p.talk(
      conv,
      "From now on, first export the table, then check the totals, then mail it to the client.",
    );
    answer = proposes({
      text: "First export the table, then check the totals, then mail it to the client.",
      kind: "procedure",
      needle: "From now on, first export",
      quote: "first export the table, then check the totals, then mail it",
    });
    await batch.runNow(p.id, p.bot.id);
    expect((await lessonsOf(p.bot.id))[0]).toMatchObject({
      kind: "procedure",
      status: "candidate",
      basis: "said",
      memoryItemId: null,
    });
  });

  test("a lesson the person dropped is not brought back by a new sighting", async () => {
    const p = await person();
    const conv = await p.chat();
    await p.talk(conv, "Never use the old export, use the new one always.");
    answer = proposes({
      text: "Use the new export.",
      needle: "Never use the old",
      quote: "use the new one always",
      topic: "export",
    });
    await batch.runNow(p.id, p.bot.id);
    const [l] = await lessonsOf(p.bot.id);
    await lessons.drop(p.id, l!.id, "person", "person");
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    await p.say(conv, "user", "Remember, never use the old export, please.", { minutesAgo: 30 });
    answer = proposes({
      text: "Use the new export, never the old.",
      needle: "Remember, never use",
      quote: "never use the old export",
      topic: "export",
    });
    await batch.runNow(p.id, p.bot.id);
    expect(await lessonsOf(p.bot.id)).toHaveLength(1);
    expect((await lessonsOf(p.bot.id))[0]).toMatchObject({ status: "dropped" });
    expect((await lessons.spread(l!.id)).chats).toBe(1);
    expect(
      (await lessons.list(p.id, { status: "all", bot: p.bot.id }))[0]!.events.map((e) => e.kind),
    ).toContain("seen_again");
    clock = new Date();
  });

  test("run now is held back for an hour, needs something new, and needs a bot that learns and a real engine", async () => {
    const p = await person();
    await expect(batch.runNow(p.id, p.bot.id)).rejects.toMatchObject({ code: "NOTHING_NEW" });
    const conv = await p.chat();
    await p.talk(conv, "Use metric units, always.");
    answer = () => ({ candidates: [] });
    const run = await batch.runNow(p.id, p.bot.id);
    expect(run).toMatchObject({ status: "done", detail: "Nothing worth keeping." });
    await expect(batch.runNow(p.id, p.bot.id)).rejects.toMatchObject({ code: "COOLDOWN" });
    await expect(batch.runNow(uuidv7(), p.bot.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const off = await person({ autoLearn: "off" });
    await expect(batch.runNow(off.id, off.bot.id)).rejects.toMatchObject({ code: "OFF" });
    const noEngine = await person({ chief: false });
    await noEngine.talk(await noEngine.chat(), "Use metric units, always.");
    await expect(batch.runNow(noEngine.id, noEngine.bot.id)).rejects.toMatchObject({
      code: "NO_ENGINE",
    });
  });

  test("an engine that fails marks the run failed and creates nothing", async () => {
    const p = await person();
    await p.talk(await p.chat(), "From now on, answer in Portuguese.");
    fail = true;
    try {
      const run = await batch.runNow(p.id, p.bot.id);
      expect(run).toMatchObject({ status: "failed", detail: "engine down" });
    } finally {
      fail = false;
    }
    expect(await lessonsOf(p.bot.id)).toEqual([]);
  });

  test("the daily tick reads a bot once a day, after its chats went quiet, with enough said, when its person allows it", async () => {
    const quiet = await person();
    await quiet.talk(await quiet.chat(), "Keep the greeting formal.");
    const little = await person();
    await little.talk(await little.chat(), "Short chat.", 2);
    const going = await person();
    const live = await going.chat();
    await going.talk(live, "Still talking to you right now.");
    await going.say(live, "user", "Right now", { minutesAgo: 1 });
    const off = await person();
    await off.talk(await off.chat(), "Another chat with enough in it.");
    await db.insert(learningPolicy).values({ ownerUserId: off.id, batch: "off" });
    answer = () => ({ candidates: [] });
    asked.length = 0;

    // The ticker reads a couple of bots per tick; call it until nothing is due.
    let ran = 0;
    for (let i = 0; i < 20; i++) {
      const n = await batch.tick();
      if (!n) break;
      ran += n;
    }
    const ranFor = (id: string) =>
      db.select().from(learningRun).where(eq(learningRun.ownerUserId, id));
    expect(await ranFor(quiet.id)).toHaveLength(1);
    expect((await ranFor(quiet.id))[0]).toMatchObject({ trigger: "daily", status: "done" });
    expect(await ranFor(little.id)).toHaveLength(0); // too little said
    expect(await ranFor(going.id)).toHaveLength(0); // a chat is still going
    expect(await ranFor(off.id)).toHaveLength(0); // its person turned the daily pass off
    expect(ran).toBeGreaterThanOrEqual(1);
    // Never twice in a day.
    for (let i = 0; i < 5; i++) await batch.tick();
    expect(await ranFor(quiet.id)).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(learningRun)
          .where(eq(learningRun.botId, quiet.bot.id))
          .orderBy(desc(learningRun.startedAt))
      )[0]!.day,
    ).toBe(clock.toISOString().slice(0, 10));
  });

  describe("the setting lessonBatch is the installation switch above each person's own", () => {
    const withSettings = () => {
      const settings = createTestSettings();
      const gated = createBatch(db, {
        lessons,
        now: () => clock,
        settings: settings.service,
        cli: async () => JSON.stringify({ candidates: [] }),
      });
      return { settings, gated };
    };
    const due = async () => {
      const p = await person();
      await p.talk(await p.chat(), "Keep the greeting formal.");
      return p;
    };
    const ranFor = (id: string) =>
      db.select().from(learningRun).where(eq(learningRun.ownerUserId, id));

    test("off stops the daily reading, on starts it again, in the same process with no restart", async () => {
      const { settings, gated } = withSettings();
      const first = await due();
      await settings.set("lessonBatch", "off");
      for (let i = 0; i < 5; i++) expect(await gated.tick()).toBe(0);
      expect(await ranFor(first.id)).toHaveLength(0);
      await settings.set("lessonBatch", "on");
      for (let i = 0; i < 20 && (await gated.tick()); i++);
      expect(await ranFor(first.id)).toHaveLength(1);
      await settings.set("lessonBatch", "off");
      const second = await due();
      for (let i = 0; i < 5; i++) expect(await gated.tick()).toBe(0);
      expect(await ranFor(second.id)).toHaveLength(0);
      await settings.unset("lessonBatch"); // the registry default is on
      for (let i = 0; i < 20 && (await gated.tick()); i++);
      expect(await ranFor(second.id)).toHaveLength(1);
    });

    test("the old variable ZETTA_LESSON_BATCH has no effect", async () => {
      const was = process.env.ZETTA_LESSON_BATCH;
      try {
        process.env.ZETTA_LESSON_BATCH = "off";
        const { settings, gated } = withSettings();
        const one = await due();
        for (let i = 0; i < 20 && (await gated.tick()); i++);
        expect(await ranFor(one.id)).toHaveLength(1); // nothing stored: the default (on), not the variable
        process.env.ZETTA_LESSON_BATCH = "on";
        await settings.set("lessonBatch", "off");
        const two = await due();
        for (let i = 0; i < 5; i++) expect(await gated.tick()).toBe(0);
        expect(await ranFor(two.id)).toHaveLength(0); // the stored off wins over the variable's on
      } finally {
        if (was === undefined) delete process.env.ZETTA_LESSON_BATCH;
        else process.env.ZETTA_LESSON_BATCH = was;
      }
    });
  });
});

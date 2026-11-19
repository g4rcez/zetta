import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { botDrivePrompt, botDriveRun } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { itemUse, replyOutcome } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createBotClaude } from "../bot-claude/store";
import { createBotQuality, QualityError } from "../bot-quality/service";
import type { CliInput } from "../chat/harness";
import { createTurnRunner } from "../chat/pipeline";
import { createMemory } from "../memory/service";
import { createLearning } from "./index";
import { createLessons } from "./lessons";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `pair-a-${uuidv7()}`;
const B = `pair-b-${uuidv7()}`;

suite("a paired test: the same question with and without what the bot knows", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const claude = createBotClaude(db);
  const learning = createLearning(db);
  let botId!: string;

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
    botId = (
      await db
        .insert(bot)
        .values({
          ownerUserId: A,
          kind: "specialist",
          visibility: "private",
          name: "Paired",
          slug: `paired-${uuidv7().slice(-10)}`,
          harness: "claude-code",
        } as never)
        .returning()
    )[0]!.id;
    // What the bot knows: a note of its own, a lesson, a procedure the search finds, a skill of the person's, an agent.
    await memory.write(
      A,
      {
        slug: "own-note",
        title: "Own note",
        content: "QUOKKA-NOTE the bot's own note.",
        type: "solo",
      },
      { by: "bot", botId },
    );
    await memory.write(
      A,
      {
        slug: "refund-procedure",
        title: "Refund procedure",
        content: "QUOKKA-PROCEDURE refund steps.",
        tags: ["instruction"],
        type: "owner",
      },
      { by: "user" },
    );
    const c = await lessons.propose({
      ownerUserId: A,
      botId,
      text: "QUOKKA-LESSON answer refund questions in one line",
      topic: "refund",
      kind: "rule",
      scope: "always",
    });
    await lessons.promote(A, c.id, "said", "system");
    await claude.addAsset(botId, {
      kind: "skill",
      name: "release-notes",
      description: "Write release notes",
      body: "QUOKKA-SKILL summarise merged PRs.",
    } as never);
    await claude.addAsset(botId, {
      kind: "agent",
      name: "reviewer",
      description: "Reviews diffs",
      body: "Review.",
      tools: ["Read"],
      model: "haiku",
    } as never);
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
    await db.$client.end();
  });

  const row = async () => (await db.select().from(bot).where(eq(bot.id, botId)))[0]!;
  // Long enough to be worth looking things up for: a one-word question is answered without searching the memory.
  const ASK =
    "Walk me through the refund procedure steps for a customer who was charged twice last month, including who has to approve it.";
  const every = (i: CliInput) => `${i.prompt}\n${i.system ?? ""}`;

  test("the turn with nothing left out sees all of it; the one without sees none of it, and keeps Zetta's own skills and the agents", async () => {
    const seen: CliInput[] = [];
    const run = createTurnRunner(
      db,
      async (i) => {
        seen.push(i);
        return "ok";
      },
      undefined,
      memory as never,
    );
    const b = await row();
    await run({ userId: A, bot: b, history: [], prompt: ASK });
    await run({
      userId: A,
      bot: b,
      history: [],
      prompt: ASK,
      without: { memory: true, skills: true },
    });
    const [full, bare] = seen as [CliInput, CliInput];
    for (const marker of ["QUOKKA-NOTE", "QUOKKA-LESSON", "QUOKKA-PROCEDURE"])
      expect(every(full)).toContain(marker);
    for (const marker of ["QUOKKA-NOTE", "QUOKKA-LESSON", "QUOKKA-PROCEDURE", "refund-procedure"])
      expect(every(bare)).not.toContain(marker);
    // The person's own skill is installed on one side only; Zetta's built-in skills and the agent are on both.
    expect(Object.keys(full.profile!.files)).toContain("skills/release-notes/SKILL.md");
    expect(Object.keys(bare.profile!.files)).not.toContain("skills/release-notes/SKILL.md");
    expect(bare.profile!.skills.map((k) => k.name)).not.toContain("release-notes");
    expect(Object.keys(bare.profile!.files)).toContain("skills/zetta-verify-before-done/SKILL.md");
    expect(Object.keys(bare.profile!.files)).toContain("agents/reviewer.md");
    // The question itself is on both sides.
    expect(every(bare)).toContain(ASK);
  });

  test("leaving out only the skills keeps the memory, and leaving out only the memory keeps the skills", async () => {
    const seen: CliInput[] = [];
    const run = createTurnRunner(
      db,
      async (i) => {
        seen.push(i);
        return "ok";
      },
      undefined,
      memory as never,
    );
    const b = await row();
    await run({
      userId: A,
      bot: b,
      history: [],
      prompt: ASK,
      without: { memory: false, skills: true },
    });
    await run({
      userId: A,
      bot: b,
      history: [],
      prompt: ASK,
      without: { memory: true, skills: false },
    });
    expect(every(seen[0]!)).toContain("QUOKKA-NOTE");
    expect(Object.keys(seen[0]!.profile!.files)).not.toContain("skills/release-notes/SKILL.md");
    expect(every(seen[1]!)).not.toContain("QUOKKA-NOTE");
    expect(Object.keys(seen[1]!.profile!.files)).toContain("skills/release-notes/SKILL.md");
  });

  // ---- the service: two runs, one pick -------------------------------------------------------------------------------------

  /** A chat service double: each turn saves a reply, as the real one does, and says what it was asked to leave out. */
  const turns: { without: unknown; content: string }[] = [];
  const chat = {
    async createConversation(actor: { userId: string }, forBot: string) {
      return (
        await db
          .insert(conversation)
          .values({ ownerUserId: actor.userId, botId: forBot, title: "t" } as never)
          .returning()
      )[0]!;
    },
    async startTurn(
      actor: { userId: string },
      conversationId: string,
      input: { content: string; withoutItems?: unknown },
    ) {
      turns.push({ without: input.withoutItems, content: input.content });
      const [m] = await db
        .insert(message)
        .values({
          conversationId,
          ownerUserId: actor.userId,
          seq: turns.length,
          role: "assistant",
          content: input.withoutItems ? "bare answer" : "full answer",
          status: "complete",
          botId,
        } as never)
        .returning();
      return {
        follow: async function* () {
          yield { event: { type: "message", message: { id: m!.id, status: "complete" } } };
        },
      };
    },
    async updateBot() {},
  };
  const quality = createBotQuality(db, { chat: chat as never, learning });
  const actor = { userId: A } as never;

  const settled = async (pairId: string) => {
    for (let i = 0; i < 100; i++) {
      const runs = await db.select().from(botDriveRun).where(eq(botDriveRun.pairId, pairId));
      if (runs.length === 2 && runs.every((r) => r.status !== "running")) return runs;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("pair did not finish");
  };

  test("compare asks twice, one after the other, the second without memory and skills; the list shows the pair with both answers", async () => {
    turns.length = 0;
    const [p] = await db
      .insert(botDrivePrompt)
      .values({ botId, ownerUserId: A, title: "Refund", prompt: "How do I refund?" } as never)
      .returning();
    const started = await quality.compare(actor, botId, p!.id);
    expect(started.started).toBe(2);
    const runs = await settled(started.pairId);
    expect(runs.map((r) => r.variant).sort()).toEqual(["with", "without"]);
    expect(turns.map((t) => t.without)).toEqual([undefined, { memory: true, skills: true }]); // the person's bot first, then the bare one
    expect(turns.map((t) => t.content)).toEqual(["How do I refund?", "How do I refund?"]);

    const drive = await quality.drive(actor, botId);
    const prompt = drive.prompts.find((x) => x.id === p!.id)!;
    expect(prompt.runs).toEqual([]); // a pair is not an ordinary run
    expect(prompt.pair).toMatchObject({
      pairId: started.pairId,
      chosen: null,
      with: { status: "done", answer: "full answer" },
      without: { status: "done", answer: "bare answer" },
    });
    // The pick waits for both answers, and nobody else can make it.
    await expect(
      quality.choose({ userId: B } as never, botId, started.pairId, { choice: "with" }),
    ).rejects.toBeInstanceOf(QualityError);
  });

  test("choosing the answer with what the bot knows counts for it, choosing the bare one counts against it, 'same' changes nothing", async () => {
    const [p] = await db
      .insert(botDrivePrompt)
      .values({ botId, ownerUserId: A, title: "Second", prompt: "Another?" } as never)
      .returning();
    const pick = async (choice: "with" | "without" | "same") => {
      const started = await quality.compare(actor, botId, p!.id);
      const runs = await settled(started.pairId);
      const withRun = runs.find((r) => r.variant === "with")!;
      // The "with" reply had the bot's items in front of it (what the chat service records for a real turn).
      await db.insert(replyOutcome).values({
        messageId: withRun.messageId!,
        ownerUserId: A,
        botId,
        origin: "server",
        outcome: "neutral",
        resolvedAt: new Date(),
      });
      const note = (await memory.read(A, "own-note"))!.page.id;
      await db.insert(itemUse).values({
        ownerUserId: A,
        botId,
        conversationId: withRun.conversationId!,
        messageId: withRun.messageId!,
        refKind: "memory",
        refId: note,
        exposure: "relevant",
        origin: "server",
      });
      expect(await quality.choose(actor, botId, started.pairId, { choice })).toEqual({
        pairId: started.pairId,
        chosen: choice,
      });
      const [o] = await db
        .select()
        .from(replyOutcome)
        .where(eq(replyOutcome.messageId, withRun.messageId!));
      const after = await db
        .select()
        .from(botDriveRun)
        .where(eq(botDriveRun.pairId, started.pairId));
      expect(after.every((r) => r.chosen === choice)).toBe(true); // written on both runs
      return o!;
    };
    expect(await pick("with")).toMatchObject({
      origin: "person",
      outcome: "good",
      signals: ["chose_better"],
    });
    expect(await pick("without")).toMatchObject({
      origin: "person",
      outcome: "bad",
      signals: ["chose_worse"],
    });
    expect(await pick("same")).toMatchObject({ origin: "server", outcome: "neutral" });
  });

  test("a run that is not part of a pair is as it was, and a pair needs a pair id", async () => {
    const [p] = await db
      .insert(botDrivePrompt)
      .values({ botId, ownerUserId: A, title: "Plain", prompt: "Plain?" } as never)
      .returning();
    turns.length = 0;
    const r = await quality.run(actor, botId, p!.id);
    expect(r.started).toBe(1);
    for (let i = 0; i < 100 && !turns.length; i++) await new Promise((x) => setTimeout(x, 20));
    expect(turns[0]!.without).toBeUndefined();
    await new Promise((x) => setTimeout(x, 100));
    await expect(
      (async () => {
        await db.insert(botDriveRun).values({
          promptId: p!.id,
          botId,
          ownerUserId: A,
          botVersion: 1,
          variant: "without",
        } as never);
      })(),
    ).rejects.toThrow(); // "without" only exists inside a pair
  });
});

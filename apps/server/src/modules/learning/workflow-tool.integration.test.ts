import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { botLesson, replyOutcome, itemUse } from "@zetta/db/schema/learning";
import { membership } from "@zetta/db/schema/identity";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createWorkflows, WorkflowError } from "../features/workflows";
import { createMemory } from "../memory/service";
import { createLessons } from "./lessons";
import { createProgress } from "./progress";
import { createLessonTools, idsOf } from "./workflow-tool";
import { createLessonWorkflow, LESSON_CHECK_NAME } from "./workflow-template";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `wft-a-${uuidv7()}`;
const B = `wft-b-${uuidv7()}`;
const U1 = "0194f0aa-1111-7000-8000-00000000000a";
const U2 = "0194F0AA-2222-7000-8000-00000000000B";

describe("idsOf", () => {
  test("takes the ids out of a list or out of text, once each, and ignores everything else", () => {
    expect(idsOf([U1, "nope"])).toEqual([U1]);
    expect(idsOf(`${U1} | the lesson is bad because\n- ${U2.toLowerCase()}, then ${U1}`)).toEqual([
      U1,
      U2.toLowerCase(),
    ]);
    expect(idsOf("NONE")).toEqual([]);
    expect(idsOf(undefined)).toEqual([]);
    expect(idsOf(42)).toEqual([]);
  });
});

suite("the lessons tool of a workflow and the weekly check", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const tools = createLessonTools({ lessons, progress: createProgress(db) });
  const asked: string[] = [];
  let pick = "NONE";
  const wf = createWorkflows(db, async ({ prompt }) => (asked.push(prompt), { text: pick }));
  const actor = (userId: string) => ({ userId, isAdmin: false }) as never;
  wf.useTools({
    call: async (u, c) => tools.call(u, c.tool, c.args),
    effect: async (_u, c) => (c.target === "lessons" ? tools.effect(c.tool) : "write"),
  });
  const template = createLessonWorkflow(db, { save: (a, v) => wf.save(a, v) as never });
  let botId!: string;
  let chiefId!: string;
  let convId!: string;
  let seq = 0;

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
    const bots = await db
      .insert(bot)
      .values([
        {
          ownerUserId: A,
          kind: "specialist",
          visibility: "private",
          name: "Worker",
          slug: `wk-${uuidv7().slice(-8)}`,
          harness: "claude-code",
        },
        {
          ownerUserId: A,
          kind: "chief",
          visibility: "private",
          name: "Chief",
          slug: `ch-${uuidv7().slice(-8)}`,
          harness: "claude-code",
        },
      ] as never)
      .returning();
    botId = bots.find((b) => b.kind === "specialist")!.id;
    chiefId = bots.find((b) => b.kind === "chief")!.id;
    convId = (
      await db
        .insert(conversation)
        .values({ ownerUserId: A, botId, title: "t" } as never)
        .returning()
    )[0]!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
    await db.$client.end();
  });

  const lesson = async (text: string, owner = A, forBot = botId) => {
    const c = await lessons.propose({
      ownerUserId: owner,
      botId: forBot,
      text,
      topic: "x",
      kind: "rule",
      scope: "topic",
    });
    return lessons.promote(owner, c.id, "said", "system");
  };
  /** `n` replies that used the lesson's item, `bad` of them stepped in on. */
  const uses = async (l: { memoryItemId: string | null }, n: number, bad: number) => {
    for (let i = 0; i < n; i++) {
      const [m] = await db
        .insert(message)
        .values({
          conversationId: convId,
          ownerUserId: A,
          seq: ++seq,
          role: "assistant",
          content: "x",
          status: "complete",
          botId,
          createdAt: new Date(Date.now() + 1000 + seq),
        } as never)
        .returning();
      await db.insert(itemUse).values({
        ownerUserId: A,
        botId,
        conversationId: convId,
        messageId: m!.id,
        refKind: "memory",
        refId: l.memoryItemId!,
        exposure: "relevant",
        origin: "person",
        createdAt: new Date(Date.now() + 1000 + seq),
      });
      await db.insert(replyOutcome).values({
        messageId: m!.id,
        ownerUserId: A,
        botId,
        origin: "person",
        outcome: i < bad ? "bad" : "good",
        resolvedAt: new Date(),
        createdAt: new Date(Date.now() + 1000 + seq),
      });
    }
  };
  const status = async (id: string) =>
    (await db.select().from(botLesson).where(eq(botLesson.id, id)))[0]!.status;

  test("list and stats read; keep, drop and restore change a lesson and say so", async () => {
    expect(["list", "stats"].map((t) => tools.effect(t))).toEqual(["read", "read"]);
    expect(["keep", "drop", "restore", "anything-else"].map((t) => tools.effect(t))).toEqual([
      "write",
      "write",
      "write",
      "write",
    ]);
    const good = await lesson("Answer in one line");
    const bad = await lesson("Always add a long preface");
    await uses(good, 6, 0);
    await uses(bad, 6, 5);
    const all = await tools.call(A, "list", {});
    expect(all).toContain(good.id);
    expect(all).toContain(bad.id);
    const hurts = await tools.call(A, "list", { label: "hurts" });
    expect(hurts).toContain(bad.id);
    expect(hurts).not.toContain(good.id);
    expect(await tools.call(A, "list", { status: "dropped" })).toBe("No lessons match.");
    expect(await tools.call(B, "list", {})).toBe("No lessons match."); // another person's lessons are not listed
    await expect(tools.call(A, "list", { bot: "not-a-uuid" })).rejects.toThrow();
    expect(await tools.call(A, "stats", { bot: botId })).toContain("Lessons: on trial 2");
    await expect(tools.call(A, "nope", {})).rejects.toMatchObject({ safe: "unknown_tool" });

    // Writes: ids from text, one result line each; one that cannot be done does not stop the rest, and another person's is refused.
    const out = await tools.call(A, "drop", { ids: `${bad.id} | hurts\n${uuidv7()} | missing` });
    expect(out).toContain(`${bad.id}: done`);
    expect(out).toMatch(/: not done \(/);
    expect(await status(bad.id)).toBe("dropped");
    expect(await tools.call(B, "drop", { ids: good.id })).toContain("not done");
    expect(await status(good.id)).toBe("trial");
    expect(await tools.call(A, "keep", { ids: [good.id] })).toContain(`${good.id}: done`);
    expect(await status(good.id)).toBe("kept");
    expect(await tools.call(A, "restore", { ids: bad.id })).toContain("done");
    expect(await status(bad.id)).toBe("trial");
    await expect(tools.call(A, "drop", { ids: "NONE" })).rejects.toMatchObject({ safe: "no_ids" });
    await expect(
      tools.call(A, "drop", { ids: Array.from({ length: 21 }, () => uuidv7()) }),
    ).rejects.toMatchObject({ safe: "too_many_ids" });
  });

  test("a workflow can only drop a lesson behind an approval step; a read needs none", async () => {
    const node = (tool: string, next: string) => ({
      type: "tool",
      botId,
      kind: "zetta",
      target: "lessons",
      tool,
      args: {},
      next,
    });
    const save = (start: string, nodes: object) =>
      wf.save(actor(A), {
        name: `wf-${uuidv7().slice(-6)}`,
        graph: { start, nodes: { ...nodes, e: { type: "end" } } },
      });
    await expect(save("drop", { drop: node("drop", "e") })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      save("p", {
        p: { type: "prompt", botId, template: "x", next: "drop" },
        drop: node("drop", "e"),
      }),
    ).rejects.toThrow(WorkflowError);
    await expect(save("list", { list: node("list", "e") })).resolves.toBeTruthy();
    await expect(
      save("a", {
        a: { type: "approval", message: "Drop?", next: "drop" },
        drop: node("drop", "e"),
      }),
    ).resolves.toBeTruthy();
    // An unknown tool counts as a change, so it needs the approval step too.
    await expect(save("x", { x: node("shred", "e") })).rejects.toMatchObject({ code: "INVALID" });
  });

  test("a workflow with a zetta step runs it: the list reaches the next step", async () => {
    const w = await wf.save(actor(A), {
      name: `wf-run-${uuidv7().slice(-6)}`,
      graph: {
        start: "list",
        nodes: {
          list: {
            type: "tool",
            botId,
            kind: "zetta",
            target: "lessons",
            tool: "list",
            args: {},
            next: "e",
          },
          e: { type: "end" },
        },
      },
    });
    const r = await wf.run(actor(A), w.id, "");
    expect(r.run.status).toBe("succeeded");
    expect(JSON.stringify(r.run)).toContain("lessons (id | status");
  });

  test("the weekly check is an ordinary workflow, made once, that waits for a yes before dropping and ends when nothing is picked", async () => {
    await expect(template.ensure(actor(B))).rejects.toMatchObject({ code: "NOT_FOUND" }); // no Chief to run it
    const made = await template.ensure(actor(A));
    expect(made.created).toBe(true);
    const again = await template.ensure(actor(A));
    expect(again).toEqual({ id: made.id, created: false });
    const [row] = await wf.list(actor(A)).then((r) => r.filter((x) => x.id === made.id));
    expect(row!.name).toBe(LESSON_CHECK_NAME);

    // Nothing picked: it ends without asking.
    pick = "NONE";
    asked.length = 0;
    const idle = await wf.run(actor(A), made.id, "");
    expect(idle.run.status).toBe("succeeded");
    expect(asked[0]).toContain("Which of them should I drop?");

    // Something picked: it stops at the question and drops nothing yet.
    const victim = await lesson("A lesson the check will pick");
    pick = `${victim.id} | hurts`;
    const waiting = await wf.run(actor(A), made.id, "");
    expect(waiting.run.status).toBe("waiting");
    expect(await status(victim.id)).toBe("trial");
    expect(chiefId).toBeTruthy();
  });
});

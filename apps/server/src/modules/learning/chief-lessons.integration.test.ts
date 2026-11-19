import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { botLesson } from "@zetta/db/schema/learning";
import { membership } from "@zetta/db/schema/identity";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChief } from "../chat/chief";
import { chiefSchemas } from "../chat/chief/schemas";
import { adminBotMay, isChiefWrite, ownBotMay } from "../chat/chief/kinds";
import { parseTools } from "../chat/tools";
import { createMemory } from "../memory/service";
import { createLessons } from "./lessons";
import { createProgress } from "./progress";
import { createLessonTools } from "./workflow-tool";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `chl-a-${uuidv7()}`;
const B = `chl-b-${uuidv7()}`;

describe("the zetta:lessons block as the bots send it", () => {
  const id = uuidv7();
  test("it parses for the chief kinds, takes ids only as ids, and only list and stats read", () => {
    const ok = parseTools('```zetta:lessons\n{"action":"list","label":"hurts"}\n```');
    expect(ok.calls).toEqual([{ kind: "lessons", args: { action: "list", label: "hurts" } }]);
    expect(
      parseTools(`\`\`\`zetta:lessons\n{"action":"drop","ids":["${id}"]}\n\`\`\``).calls,
    ).toHaveLength(1);
    expect(
      parseTools('```zetta:lessons\n{"action":"drop","ids":["not-an-id"]}\n```').rejected,
    ).toHaveLength(1);
    expect(parseTools('```zetta:lessons\n{"action":"drop","ids":[]}\n```').rejected).toHaveLength(
      1,
    );
    expect(parseTools('```zetta:lessons\n{"action":"delete","ids":[]}\n```').rejected).toHaveLength(
      1,
    );
    expect(Object.keys(chiefSchemas)).toContain("lessons");
    expect(isChiefWrite({ kind: "lessons", args: { action: "list" } })).toBe(false);
    expect(isChiefWrite({ kind: "lessons", args: { action: "stats" } })).toBe(false);
    for (const action of ["keep", "drop", "restore", "accept", "reject"])
      expect(isChiefWrite({ kind: "lessons", args: { action } })).toBe(true);
  });
  test("a person's own bot may read lessons but never change them; a bot of someone else may do neither", () => {
    const mine = { ownerUserId: "u1" };
    const me = { userId: "u1", isAdmin: false };
    expect(ownBotMay("lessons", "list", mine, me)).toBe(true);
    expect(ownBotMay("lessons", "stats", mine, me)).toBe(true);
    expect(ownBotMay("lessons", "drop", mine, me)).toBe(false);
    expect(ownBotMay("lessons", "list", { ownerUserId: "u2" }, me)).toBe(false);
    expect(ownBotMay("bot", "list", mine, me)).toBe(false); // other chief tools stay the Chief's
    expect(adminBotMay("lessons", mine, { userId: "u1", isAdmin: true })).toBe(false);
  });
});

suite("the Chief reads and changes lessons: reads at once, every change a card", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const tools = createLessonTools({ lessons, progress: createProgress(db) });
  const chief = createChief({
    db,
    chat: {} as never,
    lessons: { tools, list: (o, q) => lessons.list(o, q) },
  });
  const actor = (userId: string) => ({ userId, isAdmin: false }) as never;
  let botId!: string;
  let chiefBot!: { id: string; kind: string; ownerUserId: string };
  let plain!: { id: string; kind: string; ownerUserId: string };

  beforeAll(async () => {
    const now = new Date();
    for (const u of [A, B]) {
      await db.insert(user).values({
        id: u,
        name: u,
        email: `${u}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: u, status: "active", joinedAt: now, updatedAt: now });
    }
    const rows = await db
      .insert(bot)
      .values([
        {
          ownerUserId: A,
          kind: "chief",
          visibility: "private",
          name: "Chief",
          slug: `c-${uuidv7().slice(-8)}`,
          harness: "claude-code",
        },
        {
          ownerUserId: A,
          kind: "specialist",
          visibility: "private",
          name: "Plain",
          slug: `p-${uuidv7().slice(-8)}`,
          harness: "claude-code",
        },
      ] as never)
      .returning();
    chiefBot = rows.find((r) => r.kind === "chief")!;
    plain = rows.find((r) => r.kind === "specialist")!;
    botId = plain.id;
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
  const status = async (lid: string) =>
    (await db.select().from(botLesson).where(eq(botLesson.id, lid)))[0]!.status;

  test("list and stats answer at once, with the ids, for the Chief and for the person's own bots", async () => {
    const l = await lesson("Answer in one line");
    for (const who of [chiefBot, plain]) {
      const out = await chief.run(actor(A), who as never, "lessons", { action: "list" });
      expect(out).toMatchObject({ read: expect.stringContaining(l.id) });
    }
    expect(
      await chief.run(actor(A), chiefBot as never, "lessons", { action: "stats", bot: botId }),
    ).toMatchObject({ read: expect.stringContaining("Lessons: on trial") });
    expect(
      await chief.run(actor(B), chiefBot as never, "lessons", { action: "list" }),
    ).toMatchObject({ read: expect.stringContaining("No lessons match.") });
  });

  test("a change is a plan that names each lesson and changes nothing; applying it does the change; nobody else's lesson can be named", async () => {
    const l1 = await lesson("Always open with a joke");
    const l2 = await lesson("Sign off with the date");
    const out = await chief.run(actor(A), chiefBot as never, "lessons", {
      action: "drop",
      ids: [l1.id, l2.id],
    });
    expect(out).toMatchObject({
      plan: {
        title: "Drop 2 lessons",
        patch: { tool: "lessons", op: "drop", ids: [l1.id, l2.id] },
      },
    });
    if (!("plan" in out)) throw new Error("no plan");
    expect(out.plan.diff).toEqual([
      { field: "drop", from: "trial", to: "Always open with a joke" },
      { field: "drop", from: "trial", to: "Sign off with the date" },
    ]);
    expect(await status(l1.id)).toBe("trial"); // asking changes nothing
    await chief.apply(actor(A), out.plan.patch as never);
    expect(await status(l1.id)).toBe("dropped");
    expect(await status(l2.id)).toBe("dropped");
    // Bring one back, keep another: each its own plan.
    const back = await chief.run(actor(A), chiefBot as never, "lessons", {
      action: "restore",
      ids: [l1.id],
    });
    if (!("plan" in back)) throw new Error("no plan");
    expect(back.plan.title).toBe("Bring back a lesson");
    await chief.apply(actor(A), back.plan.patch as never);
    expect(await status(l1.id)).toBe("trial");
    // Another person's lesson, and an id that does not exist, cannot be named.
    expect(
      await chief.run(actor(B), chiefBot as never, "lessons", { action: "drop", ids: [l1.id] }),
    ).toMatchObject({ error: expect.stringContaining("no lesson of yours") });
    expect(
      await chief.run(actor(A), chiefBot as never, "lessons", { action: "drop", ids: [uuidv7()] }),
    ).toMatchObject({ error: expect.stringContaining("List first") });
    // Applying something that can be done for nobody is a failure, not a silent success.
    await expect(
      chief.apply(actor(B), { tool: "lessons", op: "drop", ids: [l1.id] } as never),
    ).rejects.toThrow("not done");
  });

  test("a bot that is not the Chief cannot plan a change even if the check before it were skipped", async () => {
    const l = await lesson("Keep answers short");
    expect(
      await chief.run(actor(A), plain as never, "lessons", { action: "drop", ids: [l.id] }),
    ).toEqual({ error: "only the Chief can change lessons." });
    expect(await status(l.id)).toBe("trial");
  });
});

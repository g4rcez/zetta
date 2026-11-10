import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botSkill, skill, skillReview } from "@zetta/db/schema/skills";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createSkills } from "../skills/service";
import { createSkillReview } from "./skill-review";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `slr-a-${uuidv7()}`;

suite("autolearn: a correction becomes a skill of the bot's own", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const skills = createSkills(db);
  let answer = '{"action":"none"}';
  const asked: string[] = [];
  const review = createSkillReview(db, skills, {
    cli: async (i) => {
      asked.push(i.prompt);
      return answer;
    },
  });
  let seq = 0;
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

  const setup = async (harness = "claude-code", autoLearn: "auto" | "suggest" | "off" = "auto") => {
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        kind: "specialist",
        visibility: "private",
        name: `Learner ${uuidv7().slice(-6)}`,
        slug: `learner-${uuidv7().slice(-10)}`,
        harness,
        autoLearn,
      } as never)
      .returning();
    const [c] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId: b!.id, title: "t" } as never)
      .returning();
    const say = async (role: "user" | "assistant", content: string, status = "complete") => {
      const [m] = await db
        .insert(message)
        .values({
          conversationId: c!.id,
          ownerUserId: A,
          seq: ++seq,
          role,
          content,
          status,
        } as never)
        .returning();
      return m!;
    };
    const turn = () =>
      review.afterTurn({ ownerUserId: A, conversationId: c!.id, startedBy: "user_message" });
    return { b: b!, c: c!, say, turn };
  };
  const receipts = async (id: string) =>
    (
      (await db.select().from(message).where(eq(message.id, id)))[0]!.meta as {
        receipts?: { kind: string; text: string; learn?: string }[];
      } | null
    )?.receipts ?? [];

  test("a correction is reviewed once; the skill is the bot's, attached to it, and the reply says Created skill", async () => {
    const { b, say, turn } = await setup();
    await say("user", "Export the sales table");
    await say("assistant", "I scraped the HTML table.");
    await say("user", "No, use the CSV export, it is exact");
    const reply = await say("assistant", "Done with the CSV export.");
    answer = JSON.stringify({
      action: "create",
      name: "sales-exports",
      description: "Use when the user asks for sales data from the dashboard.",
      body: "Use the CSV export endpoint; never scrape the HTML table. Check the row count.",
    });
    expect((await turn())?.reason).toBe("corrected");
    expect(await turn()).toBeUndefined(); // one review per reply / per half hour
    expect(await review.tick()).toBe(1);
    expect(asked.at(-1)).toContain("No, use the CSV export");
    const [s] = await db.select().from(skill).where(eq(skill.name, "sales-exports"));
    expect(s).toMatchObject({ source: "learned", learnedByBotId: b.id, ownerUserId: A });
    const links = await db.select().from(botSkill).where(eq(botSkill.skillId, s!.id));
    expect(links.map((l) => l.botId)).toEqual([b.id]);
    expect(await receipts(reply.id)).toEqual([
      expect.objectContaining({ kind: "skill", text: "sales-exports", learn: "created" }),
    ]);

    // A later lesson revises it; the owner's undo goes back to the version before.
    await db.delete(skillReview).where(eq(skillReview.botId, b.id)); // skip the half-hour debounce
    await say("user", "Actually, also sort by date");
    const reply2 = await say("assistant", "Sorted.");
    answer = JSON.stringify({
      action: "revise",
      name: "sales-exports",
      body: "Use the CSV export endpoint; never scrape the HTML table. Sort rows by date. Check the row count.",
    });
    expect((await turn())?.reason).toBe("corrected");
    await review.tick();
    const [after] = await db.select().from(skill).where(eq(skill.id, s!.id));
    expect(after!.body).toContain("Sort rows by date");
    expect(after!.version).toBe(2);
    expect((await receipts(reply2.id))[0]).toMatchObject({ learn: "revised" });
    await skills.undoLearned(A, s!.id);
    const [undone] = await db.select().from(skill).where(eq(skill.id, s!.id));
    expect(undone!.body).not.toContain("Sort rows by date");
    expect(undone!.status).toBe("active");
  });

  test("a skill the person wrote, or a learned one they edited, is never revised by the bot", async () => {
    const { b, say, turn } = await setup();
    const own = await skills.createLearned(A, b.id, {
      name: `mine-${uuidv7().slice(-6)}`,
      description: "Use when the user asks for the weekly report.",
      body: "Write the weekly report as three bullets with links to sources.",
    });
    await db.update(skill).set({ sourceState: "edited" }).where(eq(skill.id, own.id));
    await say("user", "make the report");
    await say("assistant", "Here.");
    await say("user", "No, four bullets");
    await say("assistant", "Four bullets.");
    answer = JSON.stringify({ action: "revise", name: own.name, body: "x".repeat(60) });
    await turn();
    await review.tick();
    const [same] = await db.select().from(skill).where(eq(skill.id, own.id));
    expect(same!.version).toBe(1);
    await expect(
      skills.reviseLearned(A, b.id, own.id, { body: "y".repeat(60) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("autolearn off, a harness that cannot load skills, or a turn Zetta started queue nothing", async () => {
    for (const [harness, mode] of [
      ["claude-code", "off"],
      ["codex", "auto"],
    ] as const) {
      const { say, turn } = await setup(harness, mode);
      await say("user", "do it");
      await say("assistant", "done");
      await say("user", "No, the other way");
      await say("assistant", "ok");
      expect(await turn()).toBeUndefined();
    }
    const { c, say } = await setup();
    await say("user", "do it");
    await say("assistant", "done");
    await say("user", "No, the other way");
    await say("assistant", "ok");
    expect(
      await review.afterTurn({ ownerUserId: A, conversationId: c.id, startedBy: "server" }),
    ).toBeUndefined();
  });

  test("a skill with a secret is not saved, and the review says why", async () => {
    const { say, turn } = await setup();
    await say("user", "deploy");
    await say("assistant", "deployed");
    await say("user", "No, use the staging key");
    await say("assistant", "ok");
    answer = JSON.stringify({
      action: "create",
      name: "staging-deploys",
      description: "Use when deploying to staging environments.",
      body: "Use the key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA for deploys.",
    });
    const row = await turn();
    await review.tick();
    const [r] = await db.select().from(skillReview).where(eq(skillReview.id, row!.id));
    expect(r).toMatchObject({ status: "done", outcome: "none" });
    expect(r!.detail).toContain("SECRET_REJECTED");
  });
});

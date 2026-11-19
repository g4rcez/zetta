import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botLesson, botLessonEvent, itemUse, replyOutcome } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMemory } from "../memory/service";
import { createSkills } from "../skills/service";
import { createForget } from "./forget";
import { createLessons } from "./lessons";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite(
  "the daily forgetting: a lesson nothing used is archived, with a reason and a way back",
  () => {
    const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
    const memory = createMemory(db);
    const lessons = createLessons(db, { memory });
    const skills = createSkills(db);
    const forget = createForget(db, { lessons });
    const owners: string[] = [];
    let seq = 0;

    afterAll(async () => {
      await cleanupTestUsers(db, owners);
      await db.$client.end();
    });

    const person = async () => {
      const id = `fgt-${uuidv7()}`;
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
      const [b] = await db
        .insert(bot)
        .values({
          ownerUserId: id,
          kind: "specialist",
          visibility: "private",
          name: "Forgetful",
          slug: `forgetful-${uuidv7().slice(-10)}`,
          harness: "claude-code",
        } as never)
        .returning();
      const [c] = await db
        .insert(conversation)
        .values({ ownerUserId: id, botId: b!.id, title: "t" } as never)
        .returning();
      /** A lesson that started `daysAgo` days ago (and was kept, when asked). */
      const lesson = async (text: string, daysAgo: number, o: { keep?: boolean } = {}) => {
        const c0 = await lessons.propose({
          ownerUserId: id,
          botId: b!.id,
          text,
          topic: "x",
          kind: "rule",
          scope: "topic",
        });
        let l = await lessons.promote(id, c0.id, "said", "system");
        if (o.keep) l = await lessons.keep(id, l.id, "system");
        const at = new Date(Date.now() - daysAgo * 86_400_000);
        await db.update(botLesson).set({ createdAt: at }).where(eq(botLesson.id, l.id));
        await db.update(botLessonEvent).set({ at }).where(eq(botLessonEvent.lessonId, l.id));
        return l;
      };
      const usedDaysAgo = async (
        itemId: string,
        daysAgo: number,
        exposure: "relevant" | "shown" = "relevant",
      ) => {
        const at = new Date(Date.now() - daysAgo * 86_400_000);
        const [m] = await db
          .insert(message)
          .values({
            conversationId: c!.id,
            ownerUserId: id,
            seq: ++seq,
            role: "assistant",
            content: "x",
            status: "complete",
            botId: b!.id,
            createdAt: at,
          } as never)
          .returning();
        await db.insert(itemUse).values({
          ownerUserId: id,
          botId: b!.id,
          conversationId: c!.id,
          messageId: m!.id,
          refKind: "memory",
          refId: itemId,
          exposure,
          origin: "person",
          createdAt: at,
        });
        await db.insert(replyOutcome).values({
          messageId: m!.id,
          ownerUserId: id,
          botId: b!.id,
          origin: "person",
          outcome: "good",
          resolvedAt: at,
          createdAt: at,
        });
      };
      return { id, bot: b!, lesson, usedDaysAgo };
    };
    const status = async (lessonId: string) =>
      (await db.select().from(botLesson).where(eq(botLesson.id, lessonId)))[0]!;

    test("a lesson on trial is archived after 30 quiet days, a kept one after 60; a recent use keeps it", async () => {
      const p = await person();
      const quietTrial = await p.lesson("Quiet trial lesson", 31);
      const youngTrial = await p.lesson("Young trial lesson", 20);
      const quietKept = await p.lesson("Quiet kept lesson", 61, { keep: true });
      const keptButMid = await p.lesson("Kept lesson, 45 quiet days", 45, { keep: true });
      const usedRecently = await p.lesson("Old but used last week", 90, { keep: true });
      await p.usedDaysAgo(usedRecently.memoryItemId!, 7);
      const onlyShown = await p.lesson("Old, only ever in the prompt", 40);
      await p.usedDaysAgo(onlyShown.memoryItemId!, 2, "shown"); // being in the prompt is not being used

      expect(await forget.tick({ force: true })).toBe(3);
      expect(await status(quietTrial.id)).toMatchObject({
        status: "dropped",
        dropReason: "unused",
      });
      expect(await status(quietKept.id)).toMatchObject({ status: "dropped", dropReason: "unused" });
      expect(await status(onlyShown.id)).toMatchObject({ status: "dropped", dropReason: "unused" });
      for (const keep of [youngTrial, keptButMid, usedRecently])
        expect((await status(keep.id)).status).not.toBe("dropped");
      // Archived, never deleted, with the reason written down and a way back.
      expect((await memory.read(p.id, `lesson-${quietTrial.id.slice(-12)}`))!.page.status).toBe(
        "archived",
      );
      const event = (
        await db.select().from(botLessonEvent).where(eq(botLessonEvent.lessonId, quietTrial.id))
      ).find((e) => e.kind === "dropped")!;
      expect(event).toMatchObject({ by: "system", detail: "nothing used it for 30 days" });
      expect((await lessons.restore(p.id, quietTrial.id)).status).toBe("trial");
      expect(await forget.tick({ force: true })).toBe(0); // brought back: its quiet time starts again
      // One notice, with what was archived.
      const notice = (
        await db.select().from(attentionItem).where(eq(attentionItem.ownerUserId, p.id))
      ).filter((n) => n.title.includes("archived"));
      expect(notice).toHaveLength(1);
      expect(notice[0]!.title).toBe("3 lessons were archived: nothing used them");
    });

    test("a person who turned 'forget' off keeps every lesson; a skill the bot learned is never archived by itself", async () => {
      const off = await person();
      await lessons.setPolicy(off.id, { forget: "off" });
      const quiet = await off.lesson("Quiet but protected", 100, { keep: true });
      const p = await person();
      const made = await skills.createLearned(p.id, p.bot.id, {
        name: `old-${uuidv7().slice(-6)}`,
        description: "Use when the user asks for the monthly closing.",
        body: "Run the closing checklist, then send the summary and say what is still open.",
      });
      await lessons.backfillSkills();
      await forget.tick({ force: true });
      expect((await status(quiet.id)).status).toBe("kept");
      const [fromSkill] = await db.select().from(botLesson).where(eq(botLesson.skillId, made.id));
      expect(fromSkill!.status).toBe("kept"); // a skill: its use is not counted, so "unused" would be a wrong thing to say
    });

    test("the daily run happens once a day", async () => {
      const p = await person();
      await p.lesson("Another quiet lesson", 45);
      let clock = new Date();
      const daily = createForget(db, { lessons, now: () => clock });
      expect(await daily.tick()).toBe(1);
      await p.lesson("A second quiet lesson", 45);
      expect(await daily.tick()).toBe(0); // the same day
      clock = new Date(clock.getTime() + 86_400_000 + 1000);
      expect(await daily.tick()).toBe(1);
    });
  },
);

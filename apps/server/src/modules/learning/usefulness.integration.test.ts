import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { itemUse, replyOutcome } from "@zetta/db/schema/learning";
import { skill } from "@zetta/db/schema/skills";

import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createMemory } from "../memory/service";
import { createSkills } from "../skills/service";
import { createUsefulness, LearningError, usefulnessQuery } from "./usefulness";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `use-a-${uuidv7()}`;
const B = `use-b-${uuidv7()}`;

type Outcome = "good" | "bad" | "neutral";

suite(
  "usefulness: which items are worth keeping, read from what happened after they were used",
  () => {
    const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
    const memory = createMemory(db, {
      embedder: { embed: async () => [], model: "none", dim: 0 } as never,
    });
    const skills = createSkills(db);
    const usefulness = createUsefulness(db, { memory, skills });
    let actorA!: NonNullable<Awaited<ReturnType<typeof issueBackgroundActor>>>;
    let actorB!: NonNullable<Awaited<ReturnType<typeof issueBackgroundActor>>>;
    let botId!: string;
    let otherBotId!: string;
    /** One chat per bot: the database refuses a bot's reply in another bot's chat. */
    const convs: Record<string, string> = {};
    let seq = 0;

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
      learning: { access, usefulness },
      webOrigin: "http://web.test",
      desktopOrigins: [],
      drain: () => {},
    });
    const call = async (as: string | null, method: string, path: string, body?: unknown) => {
      const r = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            ...(as ? { "x-test-user": as } : {}),
            origin: "http://web.test",
            "content-type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
      return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
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
      actorA = (await issueBackgroundActor(async () => ({ isAdmin: false }), A))!;
      actorB = (await issueBackgroundActor(async () => ({ isAdmin: false }), B))!;
      const bots = await db
        .insert(bot)
        .values(
          ["One", "Two"].map((n) => ({
            ownerUserId: A,
            kind: "specialist",
            visibility: "private",
            name: n,
            slug: `use-${n.toLowerCase()}-${uuidv7().slice(-8)}`,
            harness: "claude-code",
          })) as never,
        )
        .returning();
      botId = bots[0]!.id;
      otherBotId = bots[1]!.id;
      for (const id of [botId, otherBotId])
        convs[id] = (
          await db
            .insert(conversation)
            .values({ ownerUserId: A, botId: id, title: "t" } as never)
            .returning()
        )[0]!.id;
    });
    afterAll(async () => {
      await cleanupTestUsers(db, [A, B]);
      // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
      await db.$client.end();
    });

    /** One reply that had `refId` in front of it, and how it went. */
    const used = async (
      kind: "memory" | "skill",
      refId: string,
      outcome: Outcome,
      exposure: "relevant" | "loaded" | "always" = "relevant",
      by = botId,
      ageDays = 1,
    ) => {
      const at = new Date(Date.now() - ageDays * 86_400_000);
      const [m] = await db
        .insert(message)
        .values({
          conversationId: convs[by]!,
          ownerUserId: A,
          seq: ++seq,
          role: "assistant",
          content: "x",
          status: "complete",
          botId: by,
          createdAt: at,
        } as never)
        .returning();
      await db.insert(itemUse).values({
        ownerUserId: A,
        botId: by,
        conversationId: convs[by]!,
        messageId: m!.id,
        refKind: kind,
        refId,
        exposure,
        origin: "person",
        createdAt: at,
      });
      await db.insert(replyOutcome).values({
        messageId: m!.id,
        ownerUserId: A,
        botId: by,
        origin: "person",
        outcome,
        resolvedAt: at,
        createdAt: at,
      });
    };
    const item = async (slug: string, title = slug) =>
      (
        await memory.write(
          A,
          { slug, title, content: `${title} text`, tags: ["billing"] },
          { by: "user" },
        )
      ).page;
    /** An item added `days` ago: "unused" means a month of nobody needing it, so a fresh item is only new. */
    const aged = async (id: string, days: number) =>
      db.$client.query(
        "update memory_item set created_at = now() - make_interval(days => $2) where id = $1",
        [id, days],
      );
    const list = (q: Record<string, string> = {}, as = actorA) =>
      usefulness.list(as, usefulnessQuery.parse(q));

    test("every item is ranked by what happened after it was used, the ones nothing used included", async () => {
      const tag = uuidv7().slice(-6);
      const helps = await item(`helps-${tag}`);
      const hurts = await item(`hurts-${tag}`);
      const few = await item(`few-${tag}`);
      const idle = await item(`idle-${tag}`);
      await aged(idle.id, 60);
      const fresh = await item(`fresh-${tag}`);
      const ambient = await item(`ambient-${tag}`);
      for (let i = 0; i < 6; i++) await used("memory", helps.id, "good");
      for (let i = 0; i < 2; i++) await used("memory", hurts.id, "good");
      for (let i = 0; i < 4; i++) await used("memory", hurts.id, "bad");
      for (let i = 0; i < 3; i++) await used("memory", few.id, "good");
      await used("memory", ambient.id, "good", "always");
      const mine = skills.createLearned
        ? await skills.createLearned(A, botId, {
            name: `sk-${tag}`,
            description: "Use when the user asks about the usefulness test.",
            body: "Follow the usefulness test procedure and report what you found.",
          })
        : undefined;
      for (let i = 0; i < 5; i++) await used("skill", mine!.id, "good", "loaded");

      const r = await list({ find: tag });
      const label = (slug: string) => r.rows.find((x) => x.slug === slug)?.label;
      expect(label(helps.slug)).toBe("helps");
      expect(label(hurts.slug)).toBe("hurts");
      expect(label(few.slug)).toBe("unclear");
      expect(label(idle.slug)).toBe("unused");
      // Added today and not used yet: new, not unused.
      expect(label(fresh.slug)).toBe("unclear");
      expect(r.rows.find((x) => x.slug === fresh.slug)!.reason).toBe(
        "New: added today, nothing has used it yet.",
      );
      expect(label(ambient.slug)).toBe("unclear");
      expect(label(`sk-${tag}`)).toBe("helps");
      // Worst first: the one that hurts, then the one nothing used, then the unclear ones, then what helps.
      expect(r.rows[0]!.slug).toBe(hurts.slug);
      expect(r.rows[1]!.slug).toBe(idle.slug);
      expect(r.rows.at(-1)!.label).toBe("helps");
      expect(r.counts).toMatchObject({ hurts: 1, unused: 1, helps: 2, unclear: 3 });
      expect(r.rows.find((x) => x.slug === hurts.slug)).toMatchObject({
        uses: 6,
        good: 2,
        bad: 4,
        reason: expect.stringContaining("stepped in after 67%"),
      });
      expect(r.baselineBadRate).not.toBeNull();

      // Filters: one label, one kind, the bot a use belongs to, free text.
      expect((await list({ find: tag, label: "unused" })).rows.map((x) => x.slug)).toEqual([
        idle.slug,
      ]);
      expect((await list({ find: tag, kind: "skill" })).rows.map((x) => x.slug)).toEqual([
        `sk-${tag}`,
      ]);
      await used("memory", idle.id, "good", "relevant", otherBotId);
      // Filtering by a bot lists what that bot used (and its attached skills, and its own notes): the other bot's use is not its own.
      expect(
        (await list({ find: tag, bot: botId })).rows.find((x) => x.slug === idle.slug),
      ).toBeUndefined();
      expect((await list({ find: tag, bot: otherBotId })).rows.map((x) => x.slug)).toEqual([
        idle.slug,
      ]);
      expect((await list({ find: tag, sort: "uses" })).rows[0]!.uses).toBeGreaterThanOrEqual(6);
      expect(usefulnessQuery.safeParse({ nonsense: "1" }).success).toBe(false);
    });

    test("an item used once, long ago, is unused and says how long", async () => {
      const old = await item(`old-${uuidv7().slice(-6)}`);
      await used("memory", old.id, "good", "relevant", botId, 50);
      const row = (await list({ find: old.slug })).rows[0]!;
      expect(row).toMatchObject({ label: "unused", uses: 1 });
      expect(row.reason).toContain("not for 50 days");
    });

    test("bulk archive and restore: nothing is deleted, an item that is not theirs stops the whole call", async () => {
      const tag = uuidv7().slice(-6);
      const [a, b] = [await item(`arch-a-${tag}`), await item(`arch-b-${tag}`)];
      const theirs = (
        await memory.write(
          B,
          { slug: `theirs-${tag}`, title: "Theirs", content: "not yours" },
          { by: "user" },
        )
      ).page;
      const sk = await skills.createLearned(A, botId, {
        name: `arch-${tag}`,
        description: "Use when the user asks about archiving in the usefulness test.",
        body: "Archive and restore in the usefulness test, then say what happened.",
      });
      await expect(
        usefulness.archive(actorA, {
          items: [
            { kind: "memory", id: a.id },
            { kind: "memory", id: theirs.id },
          ],
        }),
      ).rejects.toBeInstanceOf(LearningError);
      expect((await memory.read(A, a.slug))!.page.status).toBe("current"); // nothing happened

      expect(
        await usefulness.archive(actorA, {
          items: [
            { kind: "memory", id: a.id },
            { kind: "memory", id: b.id },
            { kind: "skill", id: sk.id },
          ],
        }),
      ).toEqual({ done: 3, failed: [] });
      expect((await memory.read(A, a.slug))!.page.status).toBe("archived");
      expect((await db.select().from(skill).where(eq(skill.id, sk.id)))[0]!.status).toBe(
        "archived",
      );
      expect((await list({ find: tag })).rows).toEqual([]);
      expect((await list({ find: tag, view: "archived" })).rows.map((x) => x.slug).sort()).toEqual(
        [a.slug, b.slug, `arch-${tag}`].sort(),
      );

      expect(
        await usefulness.restore(actorA, {
          items: [
            { kind: "memory", id: a.id },
            { kind: "skill", id: sk.id },
          ],
        }),
      ).toEqual({ done: 2, failed: [] });
      expect((await memory.read(A, a.slug))!.page.status).toBe("current");
      expect((await list({ find: tag })).rows.map((x) => x.slug).sort()).toEqual(
        [a.slug, `arch-${tag}`].sort(),
      );
      // Someone else's list never shows these: B sees only their own item.
      expect((await list({ find: tag }, actorB)).rows.map((x) => x.slug)).toEqual([theirs.slug]);
    });

    test("the routes: a list with filters, a refused unknown parameter, and an archive of someone else's item is not found", async () => {
      const tag = uuidv7().slice(-6);
      const mineItem = await item(`route-${tag}`);
      await aged(mineItem.id, 60);
      const r = await call(A, "GET", `/api/learning/usefulness?find=route-${tag}&label=unused`);
      expect(r.status).toBe(200);
      expect(r.json.rows.map((x: { slug: string }) => x.slug)).toEqual([mineItem.slug]);
      expect((await call(A, "GET", "/api/learning/usefulness?nonsense=1")).status).toBe(400);
      expect((await call(A, "GET", "/api/learning/usefulness?label=great")).status).toBe(400);
      expect((await call(null, "GET", "/api/learning/usefulness")).status).toBe(401);
      const theirs = (
        await memory.write(
          B,
          { slug: `rtheirs-${tag}`, title: "Theirs", content: "no" },
          { by: "user" },
        )
      ).page;
      expect(
        (
          await call(A, "POST", "/api/learning/archive", {
            items: [{ kind: "memory", id: theirs.id }],
          })
        ).status,
      ).toBe(404);
      expect((await call(A, "POST", "/api/learning/archive", { items: [] })).status).toBe(400);
      const done = await call(A, "POST", "/api/learning/archive", {
        items: [{ kind: "memory", id: mineItem.id }],
      });
      expect(done).toMatchObject({ status: 200, json: { done: 1, failed: [] } });
      expect(actorB.userId).toBe(B);
    });
  },
);

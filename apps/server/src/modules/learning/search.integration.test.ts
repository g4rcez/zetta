import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { itemUse, replyOutcome } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMemory } from "../memory/service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `srch-a-${uuidv7()}`;

suite(
  "memory search beyond the match: what a newer item replaces, how recent it is, what happened after it was used",
  () => {
    const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
    const memory = createMemory(db); // keywords only: no embedding model in a test
    const person = { by: "user" } as const;
    let botId!: string;
    let convId!: string;
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
      botId = (
        await db
          .insert(bot)
          .values({
            ownerUserId: A,
            kind: "specialist",
            visibility: "private",
            name: "Searcher",
            slug: `searcher-${uuidv7().slice(-8)}`,
            harness: "claude-code",
          } as never)
          .returning()
      )[0]!.id;
      convId = (
        await db
          .insert(conversation)
          .values({ ownerUserId: A, botId, title: "t" } as never)
          .returning()
      )[0]!.id;
    });
    afterAll(async () => {
      await cleanupTestUsers(db, [A]);
      // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
      await db.$client.end();
    });

    const reader = () => ({ userId: A, botId });
    /** Items with the same words, so only the ranking beyond the match tells them apart. */
    const twins = async (word: string) => {
      const mk = async (slug: string) =>
        (
          await memory.write(
            A,
            {
              slug,
              title: `${word} runbook`,
              content: `The ${word} runbook says what to do.`,
              type: "owner",
            },
            person,
          )
        ).page;
      return [await mk(`${word}-a`), await mk(`${word}-b`)] as const;
    };
    const slugs = async (q: string) => (await memory.search(reader(), q, 8)).map((h) => h.slug);
    const results = async (itemId: string, good: number, bad: number) => {
      for (const outcome of [...Array(good).fill("good"), ...Array(bad).fill("bad")] as const) {
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
          } as never)
          .returning();
        await db.insert(itemUse).values({
          ownerUserId: A,
          botId,
          conversationId: convId,
          messageId: m!.id,
          refKind: "memory",
          refId: itemId,
          exposure: "relevant",
          origin: "person",
        });
        await db.insert(replyOutcome).values({
          messageId: m!.id,
          ownerUserId: A,
          botId,
          origin: "person",
          outcome: outcome as "good" | "bad",
          resolvedAt: new Date(),
        });
      }
    };

    test("an item that a current item replaces is not offered to a bot, but stays in the memory and in the person's own search", async () => {
      const tag = `sup${uuidv7().slice(-6)}`;
      const old = await memory.write(
        A,
        {
          slug: `${tag}-old`,
          title: `${tag} refund rule`,
          content: `Refunds go through ${tag} the old way.`,
          type: "owner",
        },
        person,
      );
      expect(await slugs(`${tag} refund rule`)).toEqual([`${tag}-old`]);
      const fresh = await memory.write(
        A,
        {
          slug: `${tag}-new`,
          title: `${tag} refund rule`,
          content: `Refunds go through ${tag} the new way. [[supersedes:${tag}-old]]`,
          type: "owner",
        },
        person,
      );
      expect(await slugs(`${tag} refund rule`)).toEqual([`${tag}-new`]);
      // The person's search still finds both: they may be looking for exactly the old one.
      const explored = await memory.explore(A, `${tag} refund rule`);
      expect(explored.hits.map((h) => h.slug).sort()).toEqual([`${tag}-new`, `${tag}-old`]);
      expect((await memory.read(A, `${tag}-old`))!.page.status).toBe("current"); // nothing was deleted or archived
      // When the newer item goes away the old one is offered again.
      await memory.setStatus(A, `${tag}-new`, "archived", person);
      expect(await slugs(`${tag} refund rule`)).toEqual([`${tag}-old`]);
      expect(old.page.id).not.toBe(fresh.page.id);
    });

    test("of two items that match equally, the one changed more recently comes first", async () => {
      const word = `rec${uuidv7().slice(-6)}`;
      const [a, b] = await twins(word);
      await db.$client.query(
        "update memory_item set updated_at = now() - interval '400 days' where id = $1",
        [a.id],
      );
      expect((await slugs(`${word} runbook`))[0]).toBe(b.slug);
      await db.$client.query(
        "update memory_item set updated_at = now() - interval '800 days' where id = $1",
        [b.id],
      );
      await db.$client.query("update memory_item set updated_at = now() where id = $1", [a.id]);
      expect((await slugs(`${word} runbook`))[0]).toBe(a.slug);
    });

    test("of two items that match equally, the one the person was happier after comes first; a few results barely matter", async () => {
      const word = `use${uuidv7().slice(-6)}`;
      const [a, b] = await twins(word);
      await results(a.id, 0, 30);
      await results(b.id, 30, 0);
      expect((await slugs(`${word} runbook`))[0]).toBe(b.slug);
      // Swap the verdicts: the order follows what happened.
      const word2 = `use${uuidv7().slice(-6)}`;
      const [c, d] = await twins(word2);
      await results(c.id, 30, 0);
      await results(d.id, 0, 30);
      expect((await slugs(`${word2} runbook`))[0]).toBe(c.slug);
    });

    test("recency and results break near-ties: they never bring in an item that does not match, and with nothing else to go on the better match is first", async () => {
      const word = `mat${uuidv7().slice(-6)}`;
      const exact = await memory.write(
        A,
        {
          slug: `${word}-exact`,
          title: `${word} exact`,
          content: `${word} ${word} ${word} everything about it`,
          type: "owner",
        },
        person,
      );
      const weak = await memory.write(
        A,
        {
          slug: `${word}-weak`,
          title: "Something else",
          content: `A single mention of ${word} somewhere`,
          type: "owner",
        },
        person,
      );
      const unrelated = await memory.write(
        A,
        {
          slug: `${word}-unrelated`,
          title: "Parking rules",
          content: "Where to park on Mondays.",
          type: "owner",
        },
        person,
      );
      await results(unrelated.page.id, 40, 0); // fresh, and everyone was happy after it: still not a match
      expect(await slugs(word)).toEqual([exact.page.slug, weak.page.slug]);
    });
  },
);

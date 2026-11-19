import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { messageFeedback } from "@zetta/db/schema/features";
import { itemUse, replyOutcome } from "@zetta/db/schema/learning";
import { membership } from "@zetta/db/schema/identity";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createSkills } from "../skills/service";
import { createLearning } from "./index";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `lrn-a-${uuidv7()}`;

suite("learning: what each reply had in front of it, and whether the person had to step in", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const learning = createLearning(db);
  const skills = createSkills(db);
  let seq = 0;
  /** Three minutes on: past the pause that lets a "Send now" mark land before the ticker judges a reply. */
  const later = () => new Date(Date.now() + 3 * 60_000);

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
    // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
    await db.$client.end();
  });

  const setup = async (harness = "claude-code") => {
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        kind: "specialist",
        visibility: "private",
        name: `Learner ${uuidv7().slice(-6)}`,
        slug: `learner-${uuidv7().slice(-10)}`,
        harness,
      } as never)
      .returning();
    const [c] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId: b!.id, title: "t" } as never)
      .returning();
    const say = async (
      role: "user" | "assistant",
      content: string,
      extra: { status?: string; meta?: unknown; createdAt?: Date } = {},
    ) => {
      const [m] = await db
        .insert(message)
        .values({
          conversationId: c!.id,
          ownerUserId: A,
          seq: ++seq,
          role,
          content,
          status: extra.status ?? "complete",
          ...(role === "assistant" ? { botId: b!.id } : {}),
          ...(extra.meta ? { meta: extra.meta } : {}),
          ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
        } as never)
        .returning();
      return m!;
    };
    /** A reply the person's message got, with some memory items in front of it. */
    const replied = async (
      items: { relevant?: string[]; loaded?: string[] } = { relevant: [uuidv7()] },
      extra: {
        status?: string;
        meta?: unknown;
        createdAt?: Date;
        origin?: "person" | "server";
      } = {},
    ) => {
      await say("user", "Export the sales table");
      const reply = await say("assistant", "Here it is.", extra);
      await learning.uses.record({
        replyId: reply.id,
        conversationId: c!.id,
        ownerUserId: A,
        botId: b!.id,
        origin: extra.origin ?? "person",
        harness,
        relevant: items.relevant ?? [],
        loaded: items.loaded ?? [],
        skillNames: [],
      });
      return reply;
    };
    return { b: b!, c: c!, say, replied };
  };
  const outcome = async (replyId: string) =>
    (await db.select().from(replyOutcome).where(eq(replyOutcome.messageId, replyId)))[0];

  test("a reply's items are recorded once, with the strongest way each was in front of it", async () => {
    const { b, c, say } = await setup();
    await say("user", "go");
    const reply = await say("assistant", "done");
    const [shown, both] = [uuidv7(), uuidv7()];
    const input = {
      replyId: reply.id,
      conversationId: c.id,
      ownerUserId: A,
      botId: b.id,
      origin: "person" as const,
      harness: "claude-code",
      relevant: [shown, both],
      loaded: [both],
      skillNames: [],
    };
    expect(await learning.uses.record(input)).toBe(2);
    expect(await learning.uses.record(input)).toBe(2); // a retry of the same reply writes nothing new
    const rows = await db.select().from(itemUse).where(eq(itemUse.messageId, reply.id));
    expect(rows.map((r) => [r.refId, r.exposure]).sort()).toEqual(
      [
        [shown, "relevant"],
        [both, "loaded"],
      ].sort(),
    );
    expect(
      await db.select().from(replyOutcome).where(eq(replyOutcome.messageId, reply.id)),
    ).toHaveLength(1);
  });

  test("a reply with nothing in front of it still gets a verdict: 'did the person step in' is asked of every reply", async () => {
    const { b, c, say } = await setup();
    await say("user", "hi");
    const reply = await say("assistant", "hello");
    expect(
      await learning.uses.record({
        replyId: reply.id,
        conversationId: c.id,
        ownerUserId: A,
        botId: b.id,
        origin: "person",
        harness: "claude-code",
        relevant: [],
        loaded: [],
        skillNames: [],
      }),
    ).toBe(0); // no items...
    expect(await db.select().from(itemUse).where(eq(itemUse.messageId, reply.id))).toEqual([]);
    expect(await outcome(reply.id)).toMatchObject({ outcome: "pending", origin: "person" }); // ...and a verdict still waits
    await say("user", "No, the other way");
    await learning.outcomes.tick(later());
    expect(await outcome(reply.id)).toMatchObject({ outcome: "bad", signals: ["corrected"] });
  });

  test("skills: Claude Code reports the ones it loaded by name, a Hermes bot carries every attached skill", async () => {
    const claude = await setup("claude-code");
    const name = `sales-${uuidv7().slice(-6)}`;
    const lent = await skills.createLearned(A, claude.b.id, {
      name,
      description: "Use when the user asks for sales data.",
      body: "Use the CSV export endpoint; never scrape the HTML table.",
    });
    const other = await skills.createLearned(A, claude.b.id, {
      name: `other-${uuidv7().slice(-6)}`,
      description: "Use when the user asks for something else entirely.",
      body: "Do the other thing, and say so when you are done with it.",
    });
    await claude.say("user", "sales?");
    const reply = await claude.say("assistant", "ok");
    await learning.uses.record({
      replyId: reply.id,
      conversationId: claude.c.id,
      ownerUserId: A,
      botId: claude.b.id,
      origin: "person",
      harness: "claude-code",
      relevant: [],
      loaded: [],
      skillNames: [`zetta-bot:${name}`],
    });
    const rows = await db.select().from(itemUse).where(eq(itemUse.messageId, reply.id));
    expect(rows.map((r) => [r.refKind, r.refId, r.exposure])).toEqual([
      ["skill", lent.id, "loaded"],
    ]);

    const hermes = await setup("hermes");
    const mine = await skills.createLearned(A, hermes.b.id, {
      name: `h-${uuidv7().slice(-6)}`,
      description: "Use when the user asks for a Hermes thing.",
      body: "Follow the Hermes procedure step by step and report the result.",
    });
    const r2 = await hermes.replied({ relevant: [] });
    const rows2 = await db.select().from(itemUse).where(eq(itemUse.messageId, r2.id));
    expect(rows2.map((r) => [r.refKind, r.refId, r.exposure])).toEqual([
      ["skill", mine.id, "always"],
    ]);
    expect(other.id).not.toBe(lent.id);
  });

  test("a reply Zetta started itself is neutral at once: nobody read it and wrote back", async () => {
    const { replied } = await setup();
    const reply = await replied({ relevant: [uuidv7()] }, { origin: "server" });
    expect(await outcome(reply.id)).toMatchObject({ outcome: "neutral", origin: "server" });
    expect((await outcome(reply.id))!.resolvedAt).not.toBeNull();
  });

  test("a reply waits for the person's next word; a correction makes it bad, carrying on makes it good", async () => {
    const { say, replied } = await setup();
    const reply = await replied();
    expect(await learning.outcomes.tick(later())).toBe(0); // nothing to go on yet
    expect((await outcome(reply.id))!.outcome).toBe("pending");
    await say("user", "No, use the CSV export, it is exact");
    expect(await learning.outcomes.tick(later())).toBe(1);
    expect(await outcome(reply.id)).toMatchObject({
      outcome: "bad",
      signals: ["corrected"],
      weight: -3,
    });

    const fine = await setup();
    const ok = await fine.replied();
    await fine.say("user", "Thanks, now the second table");
    await learning.outcomes.tick(later());
    expect(await outcome(ok.id)).toMatchObject({ outcome: "good", signals: ["carried_on"] });
  });

  test("a message added while the reply was written is not the next message, and counts against it only when it corrects", async () => {
    const { say, replied } = await setup();
    const reply = await replied();
    await say("user", "also the totals", {
      meta: { steer: { replyId: reply.id, at: Date.now() } },
    });
    await say("user", "Thanks, next one");
    await learning.outcomes.tick(later());
    // Adding to the request is how people chat: it says nothing against the reply.
    expect(await outcome(reply.id)).toMatchObject({ outcome: "good", signals: ["carried_on"] });

    const other = await setup();
    const corrected = await other.replied();
    await other.say("user", "No, use the staging database", {
      meta: { steer: { replyId: corrected.id, at: Date.now() } },
    });
    await other.say("user", "Thanks, next one");
    await learning.outcomes.tick(later());
    expect(await outcome(corrected.id)).toMatchObject({ outcome: "bad" });
    expect((await outcome(corrected.id))!.signals.sort()).toEqual(["carried_on", "steered"]);
  });

  test("a thumb up first and a correction after it: the reply is judged again and ends bad", async () => {
    const { b, say, replied } = await setup();
    const reply = await replied();
    await db
      .insert(messageFeedback)
      .values({ messageId: reply.id, ownerUserId: A, botId: b.id, botVersion: 1, rating: "up" });
    await learning.outcomes.resolve(reply.id, { force: true });
    expect(await outcome(reply.id)).toMatchObject({ outcome: "good", signals: ["thumbs_up"] });
    await say("user", "Actually, sort by date");
    await learning.outcomes.tick(later());
    expect(await outcome(reply.id)).toMatchObject({ outcome: "bad", weight: -1 });
  });

  test("a late thumb down judges a reply that was fine again", async () => {
    const { b, say, replied } = await setup();
    const reply = await replied();
    await say("user", "Thanks");
    await learning.outcomes.tick(later());
    expect((await outcome(reply.id))!.outcome).toBe("good");
    await db
      .insert(messageFeedback)
      .values({ messageId: reply.id, ownerUserId: A, botId: b.id, botVersion: 1, rating: "down" });
    await learning.outcomes.resolve(reply.id, { force: true });
    expect(await outcome(reply.id)).toMatchObject({ outcome: "bad", weight: -2 });
  });

  test("a stopped reply is bad, but Send now and a restart are never held against what the bot used", async () => {
    const stopped = await (
      await setup()
    ).replied({ relevant: [uuidv7()] }, { status: "cancelled" });
    const sendNow = await (
      await setup()
    ).replied({ relevant: [uuidv7()] }, { status: "cancelled", meta: { ended: "send_now" } });
    const restarted = await (
      await setup()
    ).replied({ relevant: [uuidv7()] }, { status: "interrupted" });
    await learning.outcomes.tick(later());
    expect(await outcome(stopped.id)).toMatchObject({ outcome: "bad", signals: ["stopped"] });
    expect(await outcome(sendNow.id)).toMatchObject({ outcome: "neutral", signals: ["send_now"] });
    expect(await outcome(restarted.id)).toMatchObject({
      outcome: "neutral",
      signals: ["interrupted"],
    });
  });

  test("a reply nobody answered settles as neutral after a day", async () => {
    const day = new Date(Date.now() - 2 * 86_400_000);
    const { replied } = await setup();
    const reply = await replied({ relevant: [uuidv7()] }, { createdAt: day });
    await learning.outcomes.tick(later());
    expect(await outcome(reply.id)).toMatchObject({ outcome: "neutral", signals: [] });
  });

  test("uses older than 180 days are deleted by the ticker", async () => {
    const { b, c, replied } = await setup();
    const reply = await replied();
    const old = await db
      .insert(itemUse)
      .values({
        ownerUserId: A,
        botId: b.id,
        conversationId: c.id,
        messageId: reply.id,
        refKind: "memory",
        refId: uuidv7(),
        exposure: "loaded",
        origin: "person",
        createdAt: new Date(Date.now() - 200 * 86_400_000),
      })
      .returning();
    await learning.outcomes.tick(new Date(Date.now() + 10_000_000)); // well past the hour the prune waits between runs
    expect(await db.select().from(itemUse).where(eq(itemUse.id, old[0]!.id))).toHaveLength(0);
  });

  test("backfill builds the record of past replies from what they hold, once, and only for chats", async () => {
    const { b, c, say } = await setup();
    const item = uuidv7();
    await say("user", "old question");
    const past = await say("assistant", "old answer", {
      meta: { used: { notes: [], instructions: [{ id: item }, { id: "not-an-id" }] } },
    });
    await say("user", "Thanks");
    await say("assistant", "no items", { meta: { used: { notes: [], instructions: [] } } });
    expect(await learning.backfill.run()).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(itemUse).where(eq(itemUse.messageId, past.id));
    expect(rows.map((r) => [r.botId, r.refId, r.exposure])).toEqual([[b.id, item, "relevant"]]);
    expect(await outcome(past.id)).toMatchObject({ origin: "person" });
    expect(await learning.backfill.run()).toBe(0); // nothing is recorded twice
    await learning.outcomes.tick(later());
    expect((await outcome(past.id))!.outcome).toBe("good"); // the person wrote again, and it was not a correction
    expect(c.id).toBeTruthy();
  });
});

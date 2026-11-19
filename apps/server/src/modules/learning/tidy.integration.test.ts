import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botLesson, itemUse, learningFinding, replyOutcome } from "@zetta/db/schema/learning";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMemory } from "../memory/service";
import { createFindings } from "./findings";
import { createLessons } from "./lessons";
import { createTidy, isoWeek } from "./tidy";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const DIMS = 384;
const vec = (hot: number, tilt = 0) =>
  `[${Array.from({ length: DIMS }, (_, i) => (i === hot ? 1 : i === hot + 1 ? tilt : 0)).join(",")}]`;

describe("isoWeek", () => {
  test("the week a day is in, so a person is tidied once a week", () => {
    expect(isoWeek(new Date("2026-11-16T10:00:00Z"))).toBe("2026-W47"); // a Monday
    expect(isoWeek(new Date("2026-11-22T23:00:00Z"))).toBe("2026-W47"); // the Sunday after
    expect(isoWeek(new Date("2026-11-23T00:30:00Z"))).toBe("2026-W48");
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
  });
});

suite("the weekly tidy-up: suggestions only, each one filed once", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const findings = createFindings(db, { lessons, memory });
  let clock = new Date("2026-11-18T12:00:00Z");
  const tidy = createTidy(db, { lessons, findings, now: () => clock });
  const owners: string[] = [];
  let seq = 0;
  const q = db.$client.query.bind(db.$client);

  afterAll(async () => {
    await cleanupTestUsers(db, owners);
    await db.$client.end();
  });

  const person = async () => {
    const id = `tid-${uuidv7()}`;
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
        name: "Tidied",
        slug: `tidied-${uuidv7().slice(-10)}`,
        harness: "claude-code",
      } as never)
      .returning();
    const [c] = await db
      .insert(conversation)
      .values({ ownerUserId: id, botId: b!.id, title: "t" } as never)
      .returning();
    const lesson = async (text: string, o: { keep?: boolean; days?: number } = {}) => {
      const c0 = await lessons.propose({
        ownerUserId: id,
        botId: b!.id,
        text,
        topic: "x",
        kind: "rule",
        scope: "topic",
      });
      const on = await lessons.promote(id, c0.id, "said", "system");
      if (o.days)
        await db
          .update(botLesson)
          .set({ createdAt: new Date(Date.now() - o.days * 86_400_000) })
          .where(eq(botLesson.id, on.id));
      return o.keep ? lessons.keep(id, on.id, "system") : on;
    };
    const item = async (
      slug: string,
      title: string,
      content = `${title} text`,
      tags: string[] = [],
    ) =>
      (await memory.write(id, { slug, title, content, tags, type: "owner" }, { by: "user" })).page;
    const result = async (
      itemId: string,
      outcome: "good" | "bad",
      exposure: "relevant" | "shown" = "relevant",
    ) => {
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
          createdAt: new Date(Date.now() + 1000 + seq),
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
        createdAt: new Date(Date.now() + 1000 + seq),
      });
      await db.insert(replyOutcome).values({
        messageId: m!.id,
        ownerUserId: id,
        botId: b!.id,
        origin: "person",
        outcome,
        resolvedAt: new Date(),
        createdAt: new Date(Date.now() + 1000 + seq),
      });
    };
    const noise = async (outcome: "good" | "bad", n: number) => {
      for (let i = 0; i < n; i++) {
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
          } as never)
          .returning();
        await db.insert(replyOutcome).values({
          messageId: m!.id,
          ownerUserId: id,
          botId: b!.id,
          origin: "person",
          outcome,
          resolvedAt: new Date(),
        });
      }
    };
    return { id, bot: b!, lesson, item, result, noise };
  };
  const open = (owner: string) => findings.list(owner, { status: "open" });
  const kinds = async (owner: string) => (await open(owner)).map((f) => f.kind).sort();

  test("two lessons that repeat each other, and two that pull apart, are suggestions; accepting does what a person would do by hand", async () => {
    const p = await person();
    const old = await p.lesson("Send client reports as a table");
    const dup = await p.lesson("Always send the client reports as a table");
    const a = await p.lesson("Send the sales summary as a table");
    const b = await p.lesson("Never use a table for the sales summary");
    expect(await tidy.scan(p.id)).toBe(2);
    expect(await tidy.scan(p.id)).toBe(0); // the same suggestion is never filed twice
    const list = await open(p.id);
    expect(list.map((f) => f.kind).sort()).toEqual(["check_pair", "duplicate"]);
    const duplicate = list.find((f) => f.kind === "duplicate")!;
    expect(duplicate.refs.map((r) => r.id)).toEqual([old.id, dup.id]); // the older one first: it is the one to keep
    expect(duplicate.summary).toContain("Accepting drops the newer one.");

    expect(await findings.accept(p.id, duplicate.id)).toEqual({
      id: duplicate.id,
      status: "accepted",
    });
    expect((await db.select().from(botLesson).where(eq(botLesson.id, dup.id)))[0]).toMatchObject({
      status: "dropped",
      dropReason: "duplicate",
    });
    expect((await db.select().from(botLesson).where(eq(botLesson.id, old.id)))[0]!.status).toBe(
      "trial",
    );

    const pair = list.find((f) => f.kind === "check_pair")!;
    await expect(findings.accept(p.id, pair.id)).rejects.toMatchObject({ code: "INVALID" }); // which one?
    await expect(findings.accept(p.id, pair.id, { drop: uuidv7() })).rejects.toMatchObject({
      code: "INVALID",
    });
    await findings.accept(p.id, pair.id, { drop: b.id });
    expect((await db.select().from(botLesson).where(eq(botLesson.id, b.id)))[0]).toMatchObject({
      status: "dropped",
      dropReason: "superseded",
    });
    expect((await db.select().from(botLesson).where(eq(botLesson.id, a.id)))[0]!.status).toBe(
      "trial",
    );
    await expect(findings.accept(p.id, pair.id, { drop: b.id })).rejects.toMatchObject({
      code: "INVALID",
    }); // already dealt with
    expect(await open(p.id)).toEqual([]);
  });

  test("a suggestion that was dismissed does not come back", async () => {
    const p = await person();
    await p.lesson("Keep the greeting formal");
    await p.lesson("Always keep the greeting formal");
    await tidy.scan(p.id);
    const [f] = await open(p.id);
    expect(await findings.dismiss(p.id, f!.id)).toEqual({ id: f!.id, status: "dismissed" });
    expect(await tidy.scan(p.id)).toBe(0);
    expect(await open(p.id)).toEqual([]);
    expect(await findings.list(p.id, { status: "dismissed" })).toHaveLength(1);
  });

  test("an item that a newer one replaces, and an item nobody used for a long time, are suggested; what is always in the prompt, or was used, is not", async () => {
    const p = await person();
    const old = await p.item("refund-old", "Refund rule", "Refunds the old way.");
    await p.item("refund-new", "Refund rule v2", "Refunds the new way. [[supersedes:refund-old]]");
    await p.item("stale-guide", "Old onboarding guide");
    const profile = await p.item("about-me", "About me", "I am a designer.", ["profile"]);
    const used = await p.item("used-guide", "A guide that is used");
    const fresh = await p.item("fresh-guide", "A guide made today");
    for (const slug of ["stale-guide", "about-me", "used-guide", "refund-old"])
      await q(
        "update memory_item set updated_at = now() - interval '200 days', created_at = now() - interval '200 days' where owner_user_id = $1 and slug = $2",
        [p.id, slug],
      );
    await p.result(used.id, "good");
    await tidy.scan(p.id);
    const list = await open(p.id);
    const bySlug = (kind: string) =>
      list.filter((f) => f.kind === kind).flatMap((f) => f.refs.map((r) => r.slug));
    expect(bySlug("superseded_current")).toEqual(["refund-old"]);
    expect(bySlug("unused").sort()).toEqual(["refund-old", "stale-guide"]); // the old refund item is also unused
    expect(list.flatMap((f) => f.refs.map((r) => r.slug))).not.toContain(profile.slug);
    expect(list.flatMap((f) => f.refs.map((r) => r.slug))).not.toContain(used.slug);
    expect(list.flatMap((f) => f.refs.map((r) => r.slug))).not.toContain(fresh.slug);

    const replaced = list.find((f) => f.kind === "superseded_current")!;
    await findings.accept(p.id, replaced.id);
    expect((await memory.read(p.id, "refund-old"))!.page.status).toBe("archived");
    const unused = list.find((f) => f.kind === "unused" && f.refs[0]!.slug === "stale-guide")!;
    await findings.accept(p.id, unused.id);
    expect((await memory.read(p.id, "stale-guide"))!.page.status).toBe("archived");
    // The suggestion about the archived old refund item is closed: it is gone from the list.
    expect(await open(p.id)).toEqual([]);
    expect(old.id).toBeTruthy();
  });

  test("two items that say nearly the same by meaning are suggested from the embeddings already stored: accepting links the first as the one that replaces the second", async () => {
    const p = await person();
    const a = await p.item("billing-a", "Billing export");
    const b = await p.item("billing-b", "How the billing export works");
    const c = await p.item("parking", "Parking rules");
    for (const [item, hot, tilt] of [
      [a, 0, 0],
      [b, 0, 0.05],
      [c, 100, 0],
    ] as const)
      await q(
        "insert into memory_chunk (page_id, owner_user_id, ord, text, embedding) values ($1, $2, 0, 'x', $3::vector)",
        [item.id, p.id, vec(hot, tilt)],
      );
    await tidy.scan(p.id);
    const dups = (await open(p.id)).filter((f) => f.kind === "duplicate");
    expect(dups).toHaveLength(1);
    expect(dups[0]!.refs.map((r) => r.slug).sort()).toEqual(["billing-a", "billing-b"]);
    await findings.accept(p.id, dups[0]!.id);
    const [keep, gone] = dups[0]!.refs.map((r) => r.slug!);
    expect((await memory.read(p.id, gone!))!.page.status).toBe("archived");
    // The link is written into the first item (an archived target is no longer listed as a live link).
    expect((await memory.read(p.id, keep!))!.page.content).toContain(`[[supersedes:${gone}]]`);
    expect((await memory.read(p.id, "parking"))!.page.status).toBe("current");
  });

  test("a kept lesson after which the person now steps in far more often than usual is put in front of them; it is never dropped by itself", async () => {
    const p = await person();
    await p.noise("good", 14);
    const kept = await p.lesson("Use the new template", { keep: true });
    for (const o of [
      "good",
      "bad",
      "bad",
      "bad",
      "good",
      "bad",
      "bad",
      "good",
      "bad",
      "bad",
    ] as const)
      await p.result(kept.memoryItemId!, o);
    await tidy.scan(p.id);
    const [f] = await open(p.id);
    expect(f).toMatchObject({ kind: "drop_kept", refs: [{ kind: "lesson", id: kept.id }] });
    expect(f!.summary).toContain("70% of the last 10 times");
    expect((await db.select().from(botLesson).where(eq(botLesson.id, kept.id)))[0]!.status).toBe(
      "kept",
    );
    await findings.accept(p.id, f!.id);
    expect((await db.select().from(botLesson).where(eq(botLesson.id, kept.id)))[0]).toMatchObject({
      status: "dropped",
      dropReason: "bad_results",
    });
  });

  test("only so many suggestions wait at once, and one about something that is gone closes by itself", async () => {
    const p = await person();
    for (let i = 0; i < 35; i++) await p.item(`old-${i}`, `Old item ${i}`);
    await q(
      "update memory_item set updated_at = now() - interval '200 days', created_at = now() - interval '200 days' where owner_user_id = $1",
      [p.id],
    );
    await q(
      "update memory_item set updated_at = now() - interval '200 days', created_at = now() - interval '200 days' where owner_user_id = $1",
      [p.id],
    );
    await tidy.scan(p.id);
    expect((await open(p.id)).length).toBeLessThanOrEqual(30);
    const some = (await open(p.id))[0]!;
    await memory.setStatus(p.id, some.refs[0]!.slug!, "archived", { by: "user" });
    expect((await open(p.id)).some((f) => f.id === some.id)).toBe(false);
    expect(
      (await db.select().from(learningFinding).where(eq(learningFinding.id, some.id)))[0]!.status,
    ).toBe("outdated");
  });

  test("the ticker tidies a person once a week, only when they let it, and tells them once", async () => {
    const on = await person();
    await on.lesson("Keep the answer short");
    await on.lesson("Always keep the answer short");
    const off = await person();
    await off.lesson("Keep the answer short");
    await off.lesson("Always keep the answer short");
    await lessons.setPolicy(off.id, { tidy: "off" });
    let scanned = 0;
    for (let i = 0; i < 40; i++) {
      const n = await tidy.tick();
      if (!n) break;
      scanned += n;
    }
    expect(scanned).toBeGreaterThanOrEqual(1);
    expect((await open(on.id)).map((f) => f.kind)).toEqual(["duplicate"]);
    expect(await open(off.id)).toEqual([]);
    expect(await tidy.tick()).toBe(0); // the same week: nothing more
    expect(
      (await db.select().from(attentionItem).where(eq(attentionItem.ownerUserId, on.id))).map(
        (n) => n.title,
      ),
    ).toEqual(["One suggestion to tidy up what your bots know"]);
    clock = new Date("2026-11-25T12:00:00Z"); // next week: the person is looked at again, and nothing new is filed
    await tidy.tick();
    expect((await open(on.id)).length).toBe(1);
    expect(await kinds(on.id)).toEqual(["duplicate"]);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation } from "@zetta/db/schema/chat";
import { connection } from "@zetta/db/schema/connections";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { AccessError, issueBackgroundActor, createMembershipLookup } from "../identity/access";
import { createMailboxStore, MailboxRuleError } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `mbx-a-${uuidv7()}`;
const B = `mbx-b-${uuidv7()}`;
const ids = [A, B];

suite("mailbox store against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = createMembershipLookup(db);
  const store = createMailboxStore(db);
  const actor = (id: string) => issueBackgroundActor(lookup, id).then((a) => a!);
  let a: Awaited<ReturnType<typeof actor>>;
  let b: Awaited<ReturnType<typeof actor>>;
  let botA1 = "";
  let botA2 = "";
  let botB = "";
  let chatA1 = "";
  let chatB = "";
  let secretA = "";
  let secretB = "";

  const mkBot = async (ownerUserId: string, name: string) =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId,
          kind: "specialist",
          visibility: "private",
          name,
          slug: `${name}-${uuidv7().slice(-8)}`,
        })
        .returning({ id: bot.id })
    )[0]!.id;
  const mkChat = async (ownerUserId: string, botId: string) =>
    (
      await db
        .insert(conversation)
        .values({ ownerUserId, botId })
        .returning({ id: conversation.id })
    )[0]!.id;
  const mkSecret = async (ownerUserId: string) => {
    const id = uuidv7();
    const now = new Date();
    await db.insert(connection).values({
      id,
      ownerUserId,
      kind: "api-key",
      provider: "mailbox",
      label: "Mailbox password",
      state: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
      currentCredentialVersion: 1,
    });
    return id;
  };
  const rejection = async (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    a = await actor(A);
    b = await actor(B);
    botA1 = await mkBot(A, "inbox");
    botA2 = await mkBot(A, "billing");
    botB = await mkBot(B, "theirs");
    chatA1 = await mkChat(A, botA1);
    chatB = await mkChat(B, botB);
    secretA = await mkSecret(A);
    secretB = await mkSecret(B);
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  test("create stores the address trimmed and gives the defaults", async () => {
    const row = await store.create(a, {
      kind: "imap",
      address: "  Ana@Example.invalid ",
      label: " Work ",
      config: { imapHost: "imap.example.invalid", imapPort: 993, user: "ana" },
      allowedSenders: [" Bob@Example.invalid", "@example.invalid", "bob@example.invalid", ""],
    });
    expect(row).toMatchObject({
      ownerUserId: A,
      kind: "imap",
      address: "Ana@Example.invalid",
      label: "Work",
      state: "active",
      sending: "on",
      lastError: null,
      botId: null,
      connectionId: null,
      chatConversationId: null,
      config: { imapHost: "imap.example.invalid", imapPort: 993, user: "ana" },
      allowedSenders: ["bob@example.invalid", "@example.invalid"],
    });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await store.get(a, row.id)).toEqual(row);
  });

  test("a bad address is refused", async () => {
    for (const address of ["", "no-at-sign", "a b@example.invalid", "@example.invalid", "x@"])
      expect(await rejection(store.create(a, { kind: "imap", address }))).toMatchObject({
        code: "BAD_ADDRESS",
      });
  });

  test("the address is unique per person and kind, whatever its case", async () => {
    await store.create(a, { kind: "imap", address: "dup@example.invalid" });
    const err = await rejection(store.create(a, { kind: "imap", address: "DUP@EXAMPLE.invalid" }));
    expect(err).toBeInstanceOf(MailboxRuleError);
    expect(err).toMatchObject({ code: "ADDRESS_TAKEN" });
    // Another kind, and another person, may connect the same address.
    await store.create(a, { kind: "google", address: "dup@example.invalid" });
    await store.create(b, { kind: "imap", address: "dup@example.invalid" });
    // An address the installation hands out belongs to one person only.
    await store.create(a, { kind: "provisioned", address: "bot-one@example.invalid" });
    expect(
      await rejection(store.create(b, { kind: "provisioned", address: "BOT-ONE@example.invalid" })),
    ).toMatchObject({ code: "ADDRESS_TAKEN" });
  });

  test("another person never sees or changes a mailbox", async () => {
    const mine = await store.create(a, {
      kind: "imap",
      address: "private@example.invalid",
      botId: botA1,
    });
    expect((await store.list(b)).map((m) => m.id)).not.toContain(mine.id);
    expect((await store.list(a)).map((m) => m.id)).toContain(mine.id);
    expect((await store.list(b, { botId: botA1 })).length).toBe(0);
    for (const call of [
      () => store.get(b, mine.id),
      () => store.update(b, mine.id, { label: "mine now", sending: "off" }),
      () => store.delete(b, mine.id),
    ]) {
      const err = await rejection(call());
      expect(err).toBeInstanceOf(AccessError);
      expect(err).toMatchObject({ code: "NOT_FOUND" });
    }
    // Untouched.
    expect(await store.get(a, mine.id)).toEqual(mine);
    // A person cannot attach another person's bot, saved password or chat.
    expect(
      await rejection(
        store.create(b, { kind: "imap", address: "x@example.invalid", botId: botA1 }),
      ),
    ).toMatchObject({ code: "BAD_REFERENCE" });
    expect(
      await rejection(
        store.create(b, { kind: "imap", address: "y@example.invalid", connectionId: secretA }),
      ),
    ).toMatchObject({ code: "BAD_REFERENCE" });
    expect(await rejection(store.update(a, mine.id, { botId: botB }))).toMatchObject({
      code: "BAD_REFERENCE",
    });
    expect(await rejection(store.update(a, mine.id, { connectionId: secretB }))).toMatchObject({
      code: "BAD_REFERENCE",
    });
    expect(await rejection(store.update(a, mine.id, { chatConversationId: chatB }))).toMatchObject({
      code: "BAD_REFERENCE",
    });
    expect(await store.get(a, mine.id)).toEqual(mine);
  });

  test("update changes the fields it is given and nothing else", async () => {
    const row = await store.create(a, {
      kind: "imap",
      address: "edit@example.invalid",
      connectionId: secretA,
    });
    const next = await store.update(a, row.id, {
      label: " Support ",
      sending: "off",
      allowedSenders: ["Ana@Example.invalid"],
      config: { imapHost: "imap.example.invalid" },
    });
    expect(next).toMatchObject({
      label: "Support",
      sending: "off",
      allowedSenders: ["ana@example.invalid"],
      config: { imapHost: "imap.example.invalid" },
      address: row.address,
      kind: "imap",
      connectionId: secretA,
      state: "active",
    });
    expect(next.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime());
  });

  test("state and last error move together: active clears the error, and the error is cut", async () => {
    const row = await store.create(a, { kind: "imap", address: "state@example.invalid" });
    const failed = await store.update(a, row.id, {
      state: "needs_auth",
      lastError: "The mail server did not accept the user name and password.",
    });
    expect(failed).toMatchObject({
      state: "needs_auth",
      lastError: "The mail server did not accept the user name and password.",
    });
    expect((await store.update(a, row.id, { label: "still failing" })).lastError).toBe(
      failed.lastError,
    );
    const long = await store.update(a, row.id, { state: "error", lastError: "x".repeat(900) });
    expect(long.lastError).toHaveLength(500);
    expect(await store.update(a, row.id, { state: "active" })).toMatchObject({
      state: "active",
      lastError: null,
    });
  });

  test("changing the owner bot clears the chat; the same bot keeps it", async () => {
    const row = await store.create(a, {
      kind: "imap",
      address: "owner@example.invalid",
      botId: botA1,
    });
    // A chat must be with the mailbox's own bot.
    expect(await rejection(store.update(a, row.id, { chatConversationId: chatB }))).toMatchObject({
      code: "BAD_REFERENCE",
    });
    const talking = await store.update(a, row.id, { chatConversationId: chatA1 });
    expect(talking.chatConversationId).toBe(chatA1);
    const same = await store.update(a, row.id, { botId: botA1, label: "same bot" });
    expect(same.chatConversationId).toBe(chatA1);
    const moved = await store.update(a, row.id, { botId: botA2 });
    expect(moved).toMatchObject({ botId: botA2, chatConversationId: null });
    // Back to the first bot and its chat in one call: the chat given with the change is kept.
    const back = await store.update(a, row.id, { botId: botA1, chatConversationId: chatA1 });
    expect(back).toMatchObject({ botId: botA1, chatConversationId: chatA1 });
    // Freeing the mailbox clears the chat too.
    expect(await store.update(a, row.id, { botId: null })).toMatchObject({
      botId: null,
      chatConversationId: null,
    });
  });

  test("list filters by bot, oldest first; delete removes the row", async () => {
    const one = await store.create(a, {
      kind: "imap",
      address: "l1@example.invalid",
      botId: botA2,
    });
    const two = await store.create(a, {
      kind: "imap",
      address: "l2@example.invalid",
      botId: botA2,
    });
    expect((await store.list(a, { botId: botA2 })).map((m) => m.id)).toEqual([one.id, two.id]);
    await store.delete(a, one.id);
    expect((await store.list(a, { botId: botA2 })).map((m) => m.id)).toEqual([two.id]);
    expect(await rejection(store.get(a, one.id))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejection(store.delete(a, one.id))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejection(store.get(a, "not-a-uuid"))).not.toBeNull();
  });
});

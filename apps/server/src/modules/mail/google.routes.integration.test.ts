import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { mailbox } from "@zetta/db/schema/mail";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import type {
  GoogleMailAccess,
  GoogleMailAccount,
} from "../integrations/plugins/google/mail-access";
import { MailConnectError } from "./imap-connect";
import { createMailHarness } from "./routes-harness";
import { createMailboxStore } from "./store";

/**
 * Google accounts as mailboxes, on a real database: needs `ZETTA_TEST_DB=embedded` (or a test database URL); skipped without, which looks
 * like a pass, so read the skip count. The Google connection is a fake: the real token borrowing is in `drivers/google.test.ts`.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `mbg-a-${uuidv7()}`;
const B = `mbg-b-${uuidv7()}`;
const ADDR_A = "ana.google@example.invalid";
const ADDR_B = "bia.google@example.invalid";

const account = (email: string, over: Partial<GoogleMailAccount> = {}): GoogleMailAccount => ({
  email,
  connected: true,
  read: true,
  send: true,
  ...over,
});
let accountsOf: Record<string, GoogleMailAccount[]> = {};
let disconnects = 0;
const msg = {
  id: "m1aa",
  threadId: "t1aa",
  labelIds: ["INBOX"],
  snippet: "Hello",
  internalDate: String(Date.parse("2026-01-01T10:00:00.000Z")),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Rui <rui@example.invalid>" },
      { name: "Subject", value: "Plan" },
    ],
    body: { size: 5, data: Buffer.from("Hello").toString("base64url") },
  },
};
const google: GoogleMailAccess = {
  accounts: async (a) => accountsOf[a.userId] ?? [],
  transport: (a, email) => async (r) => {
    const acc = (accountsOf[a.userId] ?? []).find((x) => x.email === email.toLowerCase());
    if (!acc?.connected)
      throw new MailConnectError(
        "AUTH",
        "This Google account is not connected any more.",
        "Connect it again in Studio > Plugins > Google.",
      );
    if (r.path === "/threads") return { threads: [{ id: "t1aa" }] };
    if (r.path === "/threads/t1aa") return { id: "t1aa", messages: [msg] };
    throw new MailConnectError("NOT_FOUND", "Gmail no longer has that message.");
  },
};

suite("Google accounts as mailboxes, over the routes", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const h = createMailHarness(db, { google });
  const rowsOf = (owner: string) =>
    db
      .select()
      .from(mailbox)
      .where(and(eq(mailbox.ownerUserId, owner), eq(mailbox.kind, "google")));

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      [A, B].map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(membership).values(
      [A, B].map((userId) => ({
        userId,
        status: "active" as const,
        joinedAt: now,
        updatedAt: now,
      })),
    );
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });
  beforeEach(async () => {
    accountsOf = { [A]: [account(ADDR_A)], [B]: [account(ADDR_B)] };
    disconnects = 0;
    h.resetRoutes();
    await db.delete(mailbox).where(eq(mailbox.kind, "google"));
  });

  test("a connected account is in the list with no step; the row holds no secret", async () => {
    const r = await h.call(A, "GET", "/api/mailboxes");
    expect(r.status).toBe(200);
    expect(r.json.mailboxes).toHaveLength(1);
    expect(r.json.mailboxes[0]).toMatchObject({
      kind: "google",
      address: ADDR_A,
      state: "active",
      sending: "off",
      ownerBotId: null,
      servers: {},
    });
    expect(r.text).not.toMatch(/connectionId|token|password/i);
    const [row] = await rowsOf(A);
    expect(row).toMatchObject({ connectionId: null, config: {} });
  });

  test("many lists at once make one row, and every caller gets it", async () => {
    const calls = await Promise.all(
      Array.from({ length: 12 }, () => h.call(A, "GET", "/api/mailboxes")),
    );
    expect(calls.every((c) => c.status === 200)).toBe(true);
    expect(
      new Set(calls.flatMap((c) => c.json.mailboxes.map((m: { id: string }) => m.id))).size,
    ).toBe(1);
    expect(await rowsOf(A)).toHaveLength(1);
  });

  test("the unique index stops a second row even when two writers race past the list", async () => {
    const store = createMailboxStore(db);
    const actor = { userId: A, isAdmin: false } as never;
    const made = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.ensureAccount(actor, "google", i % 2 ? ADDR_A.toUpperCase() : ADDR_A, {
          sending: "off",
        }),
      ),
    );
    expect(new Set(made.map((m) => m.id)).size).toBe(1);
    expect(await rowsOf(A)).toHaveLength(1);
  });

  test("another person's account never appears, and their mailbox is not found", async () => {
    const mineA = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    const mineB = (await h.call(B, "GET", "/api/mailboxes")).json.mailboxes;
    expect(mineA.map((m: { address: string }) => m.address)).toEqual([ADDR_A]);
    expect(mineB.map((m: { address: string }) => m.address)).toEqual([ADDR_B]);
    const id = mineA[0].id;
    for (const [method, path] of [
      ["GET", `/api/mailboxes/${id}/conversations`],
      ["DELETE", `/api/mailboxes/${id}`],
      ["PATCH", `/api/mailboxes/${id}`],
    ] as const)
      expect(
        (await h.call(B, method, path, method === "PATCH" ? { label: "x" } : undefined)).status,
      ).toBe(404);
  });

  test("a person with no Google connection has no Google mailbox", async () => {
    accountsOf[B] = [];
    expect((await h.call(B, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    expect(await rowsOf(B)).toHaveLength(0);
  });

  test("the inbox of the account is read through the route", async () => {
    const [box] = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    const page = await h.call(A, "GET", `/api/mailboxes/${box.id}/conversations`);
    expect(page.status).toBe(200);
    expect(page.json.conversations.map((c: { id: string }) => c.id)).toEqual(["t1aa"]);
    const one = await h.call(A, "GET", `/api/mailboxes/${box.id}/conversations/t1aa`);
    expect(one.status).toBe(200);
    expect(one.json.conversation.messages[0].text).toBe("Hello");
  });

  test("settings that are not servers are saved; servers and a password are not editable", async () => {
    const [box] = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    const ok = await h.call(A, "PATCH", `/api/mailboxes/${box.id}`, {
      label: "Gmail",
      sending: "on",
    });
    expect(ok.status).toBe(200);
    expect(ok.json.mailbox).toMatchObject({ label: "Gmail", sending: "on" });
    const refused = await h.call(A, "PATCH", `/api/mailboxes/${box.id}`, {
      imapHost: "imap.example.invalid",
    });
    expect(refused.status).toBe(501);
    // Still the same mailbox, still one row.
    expect(await rowsOf(A)).toHaveLength(1);
  });

  test("a disconnected account shows needs_auth, and a read says so in words about the Google plugin", async () => {
    const [box] = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    accountsOf[A] = [];
    const list = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: box.id, state: "needs_auth" });
    expect(list[0].lastError).toContain("Studio > Plugins > Google");
    const read = await h.call(A, "GET", `/api/mailboxes/${box.id}/conversations`);
    expect(read.status).toBe(422);
    expect(read.json.error.code).toBe("AUTH");
    expect(read.json.error.fix).toContain("Studio > Plugins > Google");
    accountsOf[A] = [account(ADDR_A)];
    const back = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    expect(back[0]).toMatchObject({ id: box.id, state: "active", lastError: null });
  });

  test("removing hides it, keeps the account connected, and it does not come back on the next list", async () => {
    const [box] = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    const del = await h.call(A, "DELETE", `/api/mailboxes/${box.id}`);
    expect(del.status).toBe(200);
    for (let i = 0; i < 3; i++)
      expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    const rows = await rowsOf(A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: box.id, state: "retired" });
    expect(accountsOf[A]).toEqual([account(ADDR_A)]);
    expect(disconnects).toBe(0);
    expect((await h.call(A, "GET", `/api/mailboxes/${box.id}/conversations`)).status).toBe(409);
    expect(h.revoked).toEqual([]); // there was no secret to revoke
  });

  test("showing it again brings the same mailbox back; an account that is not connected cannot be shown", async () => {
    const [box] = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    await h.call(A, "PATCH", `/api/mailboxes/${box.id}`, { label: "Gmail" });
    await h.call(A, "DELETE", `/api/mailboxes/${box.id}`);
    const shown = await h.call(A, "POST", "/api/mailboxes/google", { address: ADDR_A });
    expect(shown.status).toBe(200);
    expect(shown.json.mailbox).toMatchObject({ id: box.id, label: "Gmail", state: "active" });
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toHaveLength(1);
    const no = await h.call(A, "POST", "/api/mailboxes/google", {
      address: "nobody@example.invalid",
    });
    expect(no.status).toBe(409);
    expect(no.json.error.code).toBe("NO_GOOGLE");
    // Another person's account cannot be shown to this person.
    const other = await h.call(A, "POST", "/api/mailboxes/google", { address: ADDR_B });
    expect(other.status).toBe(409);
    expect(await rowsOf(B)).toHaveLength(0);
  });

  test("disconnecting the account in the plugin and connecting it again brings a removed mailbox back", async () => {
    const [box] = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes;
    await h.call(A, "DELETE", `/api/mailboxes/${box.id}`);
    accountsOf[A] = [];
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    expect(await rowsOf(A)).toHaveLength(0);
    accountsOf[A] = [account(ADDR_A)];
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toHaveLength(1);
  });
});

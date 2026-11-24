import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { gateFor, type MailTurnFacts } from "../chat/mail-policy";
import type { ActiveActor } from "../identity/access";
import type {
  GoogleMailAccess,
  GoogleMailAccount,
} from "../integrations/plugins/google/mail-access";
import { configureMailbox, mailboxPlugin, mailSendLimit } from "../integrations/plugins/mailbox";
import type { PluginContext } from "../integrations/plugins/registry";
import type { GmailRequest } from "./drivers/google";
import { MailConnectError } from "./imap-connect";
import { createMailService, MailServiceError } from "./service";
import type { Mailbox, MailboxStore } from "./store";

/**
 * The mail service over Google accounts with no database and no network: an in-memory store, a fake Google connection and a canned
 * Gmail. It covers how an account becomes a mailbox, what removing one means, and that the bots' tools and the send gate behave through
 * the Google driver as they do through IMAP. The same rules on the real database are in `google.routes.integration.test.ts`.
 */

const ME = "ana@example.invalid";
const OTHER = "bia@example.invalid";
const A = { userId: "user-a", isAdmin: false } as unknown as ActiveActor;
const B = { userId: "user-b", isAdmin: false } as unknown as ActiveActor;
const b64u = (s: string) => Buffer.from(s).toString("base64url");

// ---- an in-memory store with the semantics the service relies on ----------------------------------------------------------------
function memoryStore() {
  const rows: Mailbox[] = [];
  let n = 0;
  const mine = (a: ActiveActor, id: string) =>
    rows.find((r) => r.id === id && r.ownerUserId === a.userId);
  const store = {
    async list(a: ActiveActor) {
      return rows.filter((r) => r.ownerUserId === a.userId);
    },
    async get(a: ActiveActor, id: string) {
      const r = mine(a, id);
      if (!r) throw new Error("NOT_FOUND");
      return r;
    },
    async ensureAccount(
      a: ActiveActor,
      kind: string,
      address: string,
      o: { sending: "on" | "off" },
    ) {
      const hit = rows.find(
        (r) =>
          r.ownerUserId === a.userId &&
          r.kind === kind &&
          r.address.toLowerCase() === address.toLowerCase(),
      );
      if (hit) return hit;
      const row = {
        id: `0198f0f0-0000-7000-8000-${String(++n).padStart(12, "0")}`,
        ownerUserId: a.userId,
        kind,
        address,
        label: "",
        botId: null,
        state: "active",
        lastError: null,
        sending: o.sending,
        connectionId: null,
        config: {},
        allowedSenders: [],
        chatConversationId: null,
        createdAt: new Date(2026, 0, 1, 0, 0, n),
        updatedAt: new Date(),
      } as unknown as Mailbox;
      rows.push(row);
      return row;
    },
    async update(a: ActiveActor, id: string, p: Record<string, unknown>) {
      const r = mine(a, id);
      if (!r) throw new Error("NOT_FOUND");
      Object.assign(r, p);
      if (p.state === "active" && p.lastError === undefined) r.lastError = null;
      return r;
    },
    async delete(a: ActiveActor, id: string) {
      const i = rows.findIndex((r) => r.id === id && r.ownerUserId === a.userId);
      if (i < 0) throw new Error("NOT_FOUND");
      rows.splice(i, 1);
    },
  };
  return { rows, store: store as unknown as MailboxStore };
}

// ---- a fake Google connection and a canned Gmail --------------------------------------------------------------------------------
const account = (email: string, over: Partial<GoogleMailAccount> = {}): GoogleMailAccount => ({
  email,
  connected: true,
  read: true,
  send: true,
  ...over,
});
let accountsOf: Record<string, GoogleMailAccount[]> = {};
let accountsFail = false;
let gmailCalls: (GmailRequest & { as: string })[] = [];
let sentRaw: { raw: string; threadId?: string }[] = [];

const msg = {
  id: "m1aa",
  threadId: "t1aa",
  labelIds: ["INBOX"],
  snippet: "Hello Ana",
  internalDate: String(Date.parse("2026-01-01T10:00:00.000Z")),
  payload: {
    partId: "",
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Rui <rui@example.invalid>" },
      { name: "To", value: ME },
      { name: "Subject", value: "Plan" },
      { name: "Date", value: "Thu, 01 Jan 2026 10:00:00 +0000" },
      { name: "Message-ID", value: "<plan@example.invalid>" },
    ],
    body: { size: 9, data: b64u("Hello Ana") },
  },
};
const google: GoogleMailAccess = {
  async accounts(a) {
    if (accountsFail) throw new Error("plugin unreadable");
    return accountsOf[a.userId] ?? [];
  },
  transport: (a, email) => async (r) => {
    gmailCalls.push({ ...r, as: `${a.userId}:${email}` });
    const acc = (accountsOf[a.userId] ?? []).find((x) => x.email === email.toLowerCase());
    if (!acc?.connected)
      throw new MailConnectError("AUTH", "This Google account is not connected any more.");
    if (r.scope === "read" && !acc.read) throw new MailConnectError("AUTH", "No read permission.");
    if (r.scope === "send" && !acc.send)
      throw new MailConnectError("SEND_SCOPE", "No send permission.");
    if (r.path === "/threads") return { threads: [{ id: "t1aa" }] };
    if (r.path === "/threads/t1aa") return { id: "t1aa", messages: [msg] };
    if (r.path === "/messages/m1aa") return msg;
    if (r.path === "/messages/send") {
      sentRaw.push(r.json as { raw: string; threadId?: string });
      return { id: "sent1" };
    }
    throw new MailConnectError("NOT_FOUND", "Gmail no longer has that message.");
  },
};

let mem: ReturnType<typeof memoryStore>;
let service: ReturnType<typeof createMailService>;
beforeEach(() => {
  accountsOf = { [A.userId]: [account(ME)], [B.userId]: [account(OTHER)] };
  accountsFail = false;
  gmailCalls = [];
  sentRaw = [];
  mem = memoryStore();
  service = createMailService({
    store: mem.store,
    secrets: {
      create: async () => {
        throw new Error("a Google mailbox has no password");
      },
      list: async () => [],
      revoke: async () => {},
      secretFor: async () => {
        throw new Error("a Google mailbox has no password");
      },
    },
    google,
  });
});

describe("a connected Google account is a mailbox", () => {
  test("it is listed with no step of the person's: kind google, no secret, sending off, nobody's bot", async () => {
    const list = await service.list(A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "google",
      address: ME,
      state: "active",
      sending: "off",
      ownerBotId: null,
    });
    expect(JSON.stringify(list)).not.toMatch(/connectionId|token|secret/i);
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0]!.connectionId).toBeNull();
  });

  test("listing again, or in parallel, keeps one row", async () => {
    const lists = await Promise.all([service.list(A), service.list(A), service.rows(A)]);
    await service.list(A);
    expect(mem.rows).toHaveLength(1);
    expect(new Set(lists.flat().map((m) => m.id)).size).toBe(1);
  });

  test("an account without the read permission, or one that is not connected, is not offered", async () => {
    accountsOf[A.userId] = [
      account(ME, { read: false }),
      account("old@example.invalid", { connected: false, read: false }),
    ];
    expect(await service.list(A)).toEqual([]);
    expect(mem.rows).toHaveLength(0);
  });

  test("another person's account never appears", async () => {
    expect((await service.list(A)).map((m) => m.address)).toEqual([ME]);
    expect((await service.list(B)).map((m) => m.address)).toEqual([OTHER]);
    expect(mem.rows.map((r) => [r.ownerUserId, r.address])).toEqual([
      [A.userId, ME],
      [B.userId, OTHER],
    ]);
  });

  test("the service never asks for a password, and reads the mailbox through the account", async () => {
    const [box] = await service.list(A);
    const page = await service.conversations(A, box!.id, {});
    expect(page.conversations.map((c) => c.id)).toEqual(["t1aa"]);
    const conversation = await service.conversationText(A, box!.id, "t1aa");
    expect(conversation.messages[0]!.text).toBe("Hello Ana");
    expect(gmailCalls.every((c) => c.as === `${A.userId}:${ME}`)).toBe(true);
    expect(gmailCalls.every((c) => c.method === "GET")).toBe(true);
  });

  test("the settings that are not servers work; the servers and the password cannot be edited", async () => {
    const [box] = await service.list(A);
    const row = await service.update(A, box!.id, { label: "Gmail", sending: "on" });
    expect(row).toMatchObject({ label: "Gmail", sending: "on" });
    await expect(
      service.update(A, box!.id, { servers: { imapHost: "imap.example.invalid" } }),
    ).rejects.toBeInstanceOf(MailServiceError);
    await expect(service.update(A, box!.id, { password: "pw-test" })).rejects.toBeInstanceOf(
      MailServiceError,
    );
  });
});

describe("a disconnected account", () => {
  test("its mailbox stays and shows needs_auth with a sentence that points to the plugin", async () => {
    const [box] = await service.list(A);
    accountsOf[A.userId] = [];
    const [after] = await service.list(A);
    expect(after).toMatchObject({ id: box!.id, state: "needs_auth" });
    expect(after!.lastError).toContain("Studio > Plugins > Google");
    await expect(service.conversations(A, box!.id, {})).rejects.toMatchObject({ code: "AUTH" });
  });

  test("an account that lost the read permission says so, and works again when it is given back", async () => {
    const [box] = await service.list(A);
    accountsOf[A.userId] = [account(ME, { read: false })];
    const [lost] = await service.list(A);
    expect(lost!.state).toBe("needs_auth");
    expect(lost!.lastError).toContain("Change permissions");
    accountsOf[A.userId] = [account(ME)];
    const [back] = await service.list(A);
    expect(back).toMatchObject({ id: box!.id, state: "active", lastError: null });
    expect((await service.conversations(A, box!.id, {})).conversations).toHaveLength(1);
  });

  test("a read that fails with the sign-in records it on the mailbox", async () => {
    const [box] = await service.list(A);
    accountsOf[A.userId] = [account(ME, { connected: false, read: false })];
    await expect(service.conversations(A, box!.id, {})).rejects.toMatchObject({ code: "AUTH" });
    expect(mem.rows[0]!.state).toBe("needs_auth");
  });

  test("when the plugin cannot be read at all, nothing about the mailboxes is changed", async () => {
    await service.list(A);
    accountsFail = true;
    const list = await service.list(A);
    expect(list).toHaveLength(1);
    expect(list[0]!.state).toBe("active");
  });
});

describe("removing a Google mailbox", () => {
  test("it hides the mailbox, keeps the row, and leaves the Google account alone", async () => {
    const [box] = await service.list(A);
    await service.remove(A, box!.id);
    expect(await service.list(A)).toEqual([]);
    expect(await service.list(A)).toEqual([]); // not back on the next list
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0]!.state).toBe("retired");
    expect(accountsOf[A.userId]).toEqual([account(ME)]); // still connected in the plugin
    expect(gmailCalls).toHaveLength(0);
    await expect(service.conversations(A, box!.id, {})).rejects.toMatchObject({ code: "RETIRED" });
  });

  test("connecting the account again, after it was disconnected, brings it back", async () => {
    const [box] = await service.list(A);
    await service.remove(A, box!.id);
    accountsOf[A.userId] = []; // disconnected in the plugin
    expect(await service.list(A)).toEqual([]);
    expect(mem.rows).toHaveLength(0); // the hidden row went with the account
    accountsOf[A.userId] = [account(ME)];
    const list = await service.list(A);
    expect(list.map((m) => [m.address, m.state])).toEqual([[ME, "active"]]);
  });

  test("showing it again restores the same row, with its name and settings", async () => {
    const [box] = await service.list(A);
    await service.update(A, box!.id, { label: "Gmail", sending: "on" });
    await service.remove(A, box!.id);
    const back = await service.showAccount(A, "google", ME.toUpperCase());
    expect(back).toMatchObject({ id: box!.id, label: "Gmail", sending: "on", state: "active" });
    expect((await service.list(A)).map((m) => m.id)).toEqual([box!.id]);
  });

  test("an account that is not connected with the read permission cannot be shown", async () => {
    accountsOf[A.userId] = [account(ME, { read: false })];
    await expect(service.showAccount(A, "google", ME)).rejects.toMatchObject({ code: "NO_GOOGLE" });
    await expect(service.showAccount(A, "google", OTHER)).rejects.toMatchObject({
      code: "NO_GOOGLE",
    });
    expect(mem.rows).toHaveLength(0);
  });
});

describe("the bots' tools and the send gate through the Google driver", () => {
  const CHIEF = "bot-chief";
  const sealKey = (userId: string) => `test-seal-key-${userId}`;
  // After the outer beforeEach, which builds the service.
  beforeEach(() => {
    configureMailbox({
      store: { list: (a) => service.rows(a) },
      mail: service,
      sealKey,
      actorFor: async (userId) => ({ userId, isAdmin: false }) as never,
      botOf: async (userId, botId) =>
        botId === CHIEF && userId === A.userId
          ? { id: CHIEF, kind: "chief" as const, ownerUserId: userId }
          : null,
    });
  });
  afterAll(() => configureMailbox(undefined));
  beforeEach(() => mailSendLimit.reset());

  const tool = (name: string) => mailboxPlugin.tools!.find((t) => t.name === name)!;
  const ctx = (
    t: Partial<MailTurnFacts> = {},
    over: Partial<PluginContext> = {},
  ): PluginContext => ({
    userId: A.userId,
    botId: CHIEF,
    turn: "chat",
    config: {},
    setConfig: async () => {},
    mailGate: gateFor({
      place: "chat",
      personText: "Reply to this saying I will look at the plan on Monday",
      readElsewhere: false,
      attempts: 0,
      open: undefined,
      ...t,
    }),
    show: () => {},
    ...over,
  });
  const parse = (out: unknown) => JSON.parse(String(out)) as Record<string, any>;
  const raw = () => Buffer.from(sentRaw[0]!.raw, "base64url").toString("utf8");

  test("the Chief lists, searches and reads a Google mailbox like any other, and marks nothing", async () => {
    const [box] = await service.list(A);
    const listed = String(await tool("mailbox_list").handler(ctx(), {}));
    expect(listed).toContain(ME);
    const page = String(await tool("mail_conversations").handler(ctx(), { mailbox: box!.id }));
    expect(page).toContain("Plan");
    expect(page).toContain("t1aa");
    const read = String(
      await tool("mail_read").handler(ctx(), { mailbox: ME, conversation: "t1aa" }),
    );
    expect(read).toContain("Hello Ana");
    expect(read).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(gmailCalls.every((c) => c.method === "GET")).toBe(true);
  });

  test("the plugin cannot read another person's Google mailbox", async () => {
    await service.list(B);
    const e = await tool("mail_read")
      .handler(ctx(), { mailbox: OTHER, conversation: "t1aa" })
      .catch((x) => x);
    expect(e.code).toBe("NOT_FOUND");
    expect(gmailCalls.filter((c) => c.as.startsWith(B.userId))).toHaveLength(0);
  });

  test("a mailbox whose account is disconnected is refused in words that point to the Google plugin", async () => {
    await service.list(A);
    accountsOf[A.userId] = [];
    const e = await tool("mail_conversations")
      .handler(ctx(), { mailbox: ME })
      .catch((x) => x);
    expect(e.code).toBe("MAIL_AUTH");
    expect(e.fix).toContain("Studio > Plugins > Google");
    expect(e.safe).not.toContain("password");
  });

  test("sending is off until the person turns it on", async () => {
    const [box] = await service.list(A);
    const open = { mailboxId: box!.id, conversationId: "t1aa" };
    const reply = () =>
      tool("mail_reply")
        .handler(ctx({ open }), {
          mailbox: box!.id,
          conversation: "t1aa",
          text: "I will look at the plan on Monday.",
        })
        .catch((x) => x);
    const refused = await reply();
    expect(refused.code).toBe("MAIL_SENDING_OFF");
    expect(sentRaw).toHaveLength(0);
    await service.update(A, box!.id, { sending: "on" });
    const out = String(await reply());
    expect(out).toContain("rui@example.invalid");
    expect(out).not.toContain("Sent folder"); // Gmail files its own copy
    expect(sentRaw).toHaveLength(1);
    expect(sentRaw[0]!.threadId).toBe("t1aa");
    expect(raw()).toContain("In-Reply-To: <plan@example.invalid>");
    expect(raw()).toContain("Subject: Re: Plan");
  });

  test("the gate is the same: a reply nobody asked for waits for the person's card, nothing leaves", async () => {
    const [box] = await service.list(A);
    await service.update(A, box!.id, { sending: "on" });
    const e = await tool("mail_reply")
      .handler(
        ctx(
          { open: { mailboxId: box!.id, conversationId: "t1aa" }, personText: "Summarise this" },
          {},
        ),
        { mailbox: box!.id, conversation: "t1aa", text: "I will look at the plan on Monday." },
      )
      .catch((x) => x);
    expect(e.constructor.name).toBe("PluginPause");
    expect(sentRaw).toHaveLength(0);
  });

  test("an account without the send permission fails the send in words about that permission, and the mailbox still reads", async () => {
    const [box] = await service.list(A);
    await service.update(A, box!.id, { sending: "on" });
    accountsOf[A.userId] = [account(ME, { send: false })];
    const e = await tool("mail_send")
      .handler(ctx({ personText: "Email rui@example.invalid the plan" }), {
        mailbox: box!.id,
        to: ["rui@example.invalid"],
        subject: "Plan",
        text: "Hello",
      })
      .catch((x) => x);
    expect(e.code).toBe("MAIL_AUTH");
    expect(sentRaw).toHaveLength(0);
    expect(mem.rows[0]!.state).toBe("active"); // a missing send permission does not stop the reading
    expect(
      parse(await tool("mail_conversations").handler(ctx(), { mailbox: box!.id })),
    ).toBeTruthy();
  });
});

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { gateFor, type MailTurnFacts } from "../chat/mail-policy";
import type { ActiveActor } from "../identity/access";
import type { GoogleMailAccess } from "../integrations/plugins/google/mail-access";
import type {
  MicrosoftMailAccess,
  MicrosoftMailAccount,
} from "../integrations/plugins/microsoft/mail-access";
import { configureMailbox, mailboxPlugin, mailSendLimit } from "../integrations/plugins/mailbox";
import type { PluginContext } from "../integrations/plugins/registry";
import type { GraphRequest } from "./drivers/microsoft";
import { MailConnectError } from "./imap-connect";
import { createMailService } from "./service";
import type { AccountKind, Mailbox, MailboxStore } from "./store";

/**
 * The mail service over Microsoft accounts with no database and no network: an in-memory store, a fake Microsoft connection and a canned
 * Graph. It covers how an account becomes a mailbox, what removing one means, that Google and Microsoft accounts live side by side, and
 * that the bots' tools and the send gate behave through the Microsoft driver as they do through IMAP. The same rules on the real
 * database are in `microsoft.routes.integration.test.ts`. No real Microsoft account was used.
 */

const ME = "ana@example.invalid";
const OTHER = "bia@example.invalid";
const A = { userId: "user-a", isAdmin: false } as unknown as ActiveActor;
const B = { userId: "user-b", isAdmin: false } as unknown as ActiveActor;
const CONV = "AAQkADconv-one_1=";

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
      kind: AccountKind,
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

const account = (
  email: string,
  over: Partial<MicrosoftMailAccount> = {},
): MicrosoftMailAccount => ({
  email,
  connected: true,
  read: true,
  send: true,
  ...over,
});
let accountsOf: Record<string, MicrosoftMailAccount[]> = {};
let googleAccountsOf: Record<string, MicrosoftMailAccount[]> = {};
let accountsFail = false;
let graphCalls: (GraphRequest & { by: string })[] = [];
let sent: { path: string; body: any }[] = [];

const message = {
  id: "m1aa",
  conversationId: CONV,
  internetMessageId: "<plan@example.invalid>",
  subject: "Plan",
  bodyPreview: "Hello Ana",
  body: { contentType: "text", content: "Hello Ana" },
  from: { emailAddress: { name: "Rui", address: "rui@example.invalid" } },
  toRecipients: [{ emailAddress: { address: ME } }],
  ccRecipients: [],
  replyTo: [],
  receivedDateTime: "2026-01-01T10:00:00.000Z",
  sentDateTime: "2026-01-01T10:00:00.000Z",
  hasAttachments: false,
  isDraft: false,
  parentFolderId: "AAMkINBOX=",
};
const microsoft: MicrosoftMailAccess = {
  async accounts(a) {
    if (accountsFail) throw new Error("plugin unreadable");
    return accountsOf[a.userId] ?? [];
  },
  transport: (a, email) => async (r) => {
    graphCalls.push({ ...r, by: `${a.userId}:${email}` });
    const acc = (accountsOf[a.userId] ?? []).find((x) => x.email === email.toLowerCase());
    if (!acc?.connected)
      throw new MailConnectError("AUTH", "This Microsoft account is not connected any more.");
    if (r.scope === "read" && !acc.read) throw new MailConnectError("AUTH", "No read permission.");
    if (r.scope === "send" && !acc.send)
      throw new MailConnectError("SEND_SCOPE", "No send permission.");
    if (r.path === "/me/mailFolders/inbox/messages") return { value: [message] };
    if (r.path === "/me/mailFolders/sentitems") return { id: "AAMkSENT=" };
    if (r.path === "/me/mailFolders/deleteditems") return { id: "AAMkDEL=" };
    if (r.path === "/me/mailFolders/junkemail") return { id: "AAMkJUNK=" };
    if (r.path === "/me/messages") return { value: [message] };
    if (r.path === "/me/messages/m1aa") return message;
    if (r.method === "POST") {
      sent.push({ path: r.path, body: r.json });
      return {};
    }
    throw new MailConnectError("NOT_FOUND", "Outlook no longer has that message.");
  },
};
const google: GoogleMailAccess = {
  accounts: async (a) => googleAccountsOf[a.userId] ?? [],
  transport: () => async () => {
    throw new Error("not used here");
  },
};

let mem: ReturnType<typeof memoryStore>;
let service: ReturnType<typeof createMailService>;
beforeEach(() => {
  accountsOf = { [A.userId]: [account(ME)], [B.userId]: [account(OTHER)] };
  googleAccountsOf = {};
  accountsFail = false;
  graphCalls = [];
  sent = [];
  mem = memoryStore();
  service = createMailService({
    store: mem.store,
    secrets: {
      create: async () => {
        throw new Error("a Microsoft mailbox has no password");
      },
      list: async () => [],
      revoke: async () => {},
      secretFor: async () => {
        throw new Error("a Microsoft mailbox has no password");
      },
    },
    google,
    microsoft,
  });
});

describe("a connected Microsoft account is a mailbox", () => {
  test("it is listed with no step of the person's: kind microsoft, no secret, sending off, nobody's bot", async () => {
    const list = await service.list(A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "microsoft",
      address: ME,
      state: "active",
      sending: "off",
      ownerBotId: null,
    });
    expect(JSON.stringify(list)).not.toMatch(/connectionId|token|secret/i);
    expect(mem.rows[0]!.connectionId).toBeNull();
  });

  test("listing again, or in parallel, keeps one row; another person's account never appears", async () => {
    const lists = await Promise.all([service.list(A), service.list(A), service.rows(A)]);
    await service.list(A);
    expect(mem.rows.filter((r) => r.ownerUserId === A.userId)).toHaveLength(1);
    expect(new Set(lists.flat().map((m) => m.id)).size).toBe(1);
    expect((await service.list(B)).map((m) => m.address)).toEqual([OTHER]);
  });

  test("an account without the read permission, or one that is not connected, is not offered", async () => {
    accountsOf[A.userId] = [
      account(ME, { read: false }),
      account("old@example.invalid", { connected: false, read: false }),
    ];
    expect(await service.list(A)).toEqual([]);
    expect(mem.rows).toHaveLength(0);
  });

  test("a Google account and a Microsoft account of one address are two mailboxes, each read through its own plugin", async () => {
    googleAccountsOf[A.userId] = [account(ME)];
    const list = await service.list(A);
    expect(list.map((m) => m.kind).sort()).toEqual(["google", "microsoft"]);
    // Losing one does not touch the other.
    accountsOf[A.userId] = [];
    const after = await service.list(A);
    expect(Object.fromEntries(after.map((m) => [m.kind, m.state]))).toEqual({
      google: "active",
      microsoft: "needs_auth",
    });
  });

  test("the service never asks for a password, and reads the mailbox through the account with reads only", async () => {
    const [box] = await service.list(A);
    const page = await service.conversations(A, box!.id, {});
    expect(page.conversations.map((c) => c.id)).toEqual([CONV]);
    const conversation = await service.conversationText(A, box!.id, CONV);
    expect(conversation.messages[0]!.text).toBe("Hello Ana");
    expect(graphCalls.every((c) => c.by === `${A.userId}:${ME}`)).toBe(true);
    expect(graphCalls.every((c) => c.method === "GET")).toBe(true);
  });

  test("the settings that are not servers work; the servers and the password cannot be edited", async () => {
    const [box] = await service.list(A);
    expect(await service.update(A, box!.id, { label: "Outlook", sending: "on" })).toMatchObject({
      label: "Outlook",
      sending: "on",
    });
    await expect(
      service.update(A, box!.id, { servers: { imapHost: "imap.example.invalid" } }),
    ).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    await expect(service.update(A, box!.id, { password: "pw-test" })).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
  });
});

describe("a disconnected account", () => {
  test("its mailbox stays and shows needs_auth with a sentence that points to the Microsoft plugin", async () => {
    const [box] = await service.list(A);
    accountsOf[A.userId] = [];
    const [after] = await service.list(A);
    expect(after).toMatchObject({ id: box!.id, state: "needs_auth" });
    expect(after!.lastError).toContain("Studio > Plugins > Microsoft");
    await expect(service.conversations(A, box!.id, {})).rejects.toMatchObject({ code: "AUTH" });
  });

  test("an account that lost the read permission says so, and works again when it is given back", async () => {
    const [box] = await service.list(A);
    accountsOf[A.userId] = [account(ME, { read: false })];
    const [lost] = await service.list(A);
    expect(lost!.state).toBe("needs_auth");
    expect(lost!.lastError).toContain("Mail: read messages");
    accountsOf[A.userId] = [account(ME)];
    expect(await service.list(A)).toMatchObject([
      { id: box!.id, state: "active", lastError: null },
    ]);
  });

  test("when the plugin cannot be read at all, nothing about the mailboxes is changed", async () => {
    await service.list(A);
    accountsFail = true;
    const list = await service.list(A);
    expect(list).toHaveLength(1);
    expect(list[0]!.state).toBe("active");
  });
});

describe("removing a Microsoft mailbox", () => {
  test("it hides the mailbox, keeps the row, and leaves the account connected in the plugin", async () => {
    const [box] = await service.list(A);
    await service.remove(A, box!.id);
    expect(await service.list(A)).toEqual([]);
    expect(await service.list(A)).toEqual([]); // not back on the next list
    expect(mem.rows[0]!.state).toBe("retired");
    expect(accountsOf[A.userId]).toEqual([account(ME)]);
    expect(graphCalls).toHaveLength(0);
    await expect(service.conversations(A, box!.id, {})).rejects.toMatchObject({ code: "RETIRED" });
  });

  test("connecting the account again, after it was disconnected, brings it back", async () => {
    const [box] = await service.list(A);
    await service.remove(A, box!.id);
    accountsOf[A.userId] = [];
    expect(await service.list(A)).toEqual([]);
    expect(mem.rows).toHaveLength(0);
    accountsOf[A.userId] = [account(ME)];
    expect((await service.list(A)).map((m) => [m.address, m.state])).toEqual([[ME, "active"]]);
  });

  test("showing it again restores the same row; an account that cannot read, or is not this person's, cannot be shown", async () => {
    const [box] = await service.list(A);
    await service.update(A, box!.id, { label: "Outlook", sending: "on" });
    await service.remove(A, box!.id);
    const back = await service.showAccount(A, "microsoft", ME.toUpperCase());
    expect(back).toMatchObject({ id: box!.id, label: "Outlook", sending: "on", state: "active" });
    await expect(service.showAccount(A, "microsoft", OTHER)).rejects.toMatchObject({
      code: "NO_MICROSOFT",
    });
    // The Google plugin does not have it: a Microsoft account is not shown as a Google one.
    await expect(service.showAccount(A, "google", ME)).rejects.toMatchObject({ code: "NO_GOOGLE" });
  });
});

describe("the bots' tools and the send gate through the Microsoft driver", () => {
  const CHIEF = "bot-chief";
  beforeEach(() => {
    configureMailbox({
      store: { list: (a) => service.rows(a) },
      mail: service,
      sealKey: (userId: string) => `test-seal-key-${userId}`,
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
  const ctx = (t: Partial<MailTurnFacts> = {}): PluginContext => ({
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
  });

  test("the Chief lists, searches and reads a Microsoft mailbox like any other, and changes nothing", async () => {
    const [box] = await service.list(A);
    expect(String(await tool("mailbox_list").handler(ctx(), {}))).toContain(ME);
    const page = String(await tool("mail_conversations").handler(ctx(), { mailbox: box!.id }));
    expect(page).toContain("Plan");
    const read = String(
      await tool("mail_read").handler(ctx(), { mailbox: ME, conversation: CONV }),
    );
    expect(read).toContain("Hello Ana");
    expect(read).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(graphCalls.every((c) => c.method === "GET")).toBe(true);
  });

  test("the plugin cannot read another person's Microsoft mailbox", async () => {
    await service.list(B);
    const e = await tool("mail_read")
      .handler(ctx(), { mailbox: OTHER, conversation: CONV })
      .catch((x) => x);
    expect(e.code).toBe("NOT_FOUND");
    expect(graphCalls.filter((c) => c.by.startsWith(B.userId))).toHaveLength(0);
  });

  test("a mailbox whose account is disconnected is refused in words that point to the Microsoft plugin", async () => {
    await service.list(A);
    accountsOf[A.userId] = [];
    const e = await tool("mail_conversations")
      .handler(ctx(), { mailbox: ME })
      .catch((x) => x);
    expect(e.code).toBe("MAIL_AUTH");
    expect(e.fix).toContain("Studio > Plugins > Microsoft");
    expect(e.safe).not.toContain("password");
  });

  test("sending is off until the person turns it on; then the reply goes through the reply action, and Outlook files the copy", async () => {
    const [box] = await service.list(A);
    const open = { mailboxId: box!.id, conversationId: CONV };
    const reply = () =>
      tool("mail_reply")
        .handler(ctx({ open }), {
          mailbox: box!.id,
          conversation: CONV,
          text: "I will look at the plan on Monday.",
        })
        .catch((x) => x);
    expect((await reply()).code).toBe("MAIL_SENDING_OFF");
    expect(sent).toHaveLength(0);
    await service.update(A, box!.id, { sending: "on" });
    const out = String(await reply());
    expect(out).toContain("rui@example.invalid");
    expect(out).not.toContain("Sent folder"); // Outlook files its own copy
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe("/me/messages/m1aa/reply");
    expect(sent[0]!.body.message.toRecipients).toEqual([
      { emailAddress: { address: "rui@example.invalid" } },
    ]);
  });

  test("the gate is the same: a reply nobody asked for waits for the person's card, nothing leaves", async () => {
    const [box] = await service.list(A);
    await service.update(A, box!.id, { sending: "on" });
    const e = await tool("mail_reply")
      .handler(
        ctx({ open: { mailboxId: box!.id, conversationId: CONV }, personText: "Summarise this" }),
        { mailbox: box!.id, conversation: CONV, text: "I will look at the plan on Monday." },
      )
      .catch((x) => x);
    expect(e.constructor.name).toBe("PluginPause");
    expect(sent).toHaveLength(0);
  });

  test("an account without Mail.Send fails the send in words about that permission, and the mailbox still reads", async () => {
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
    expect(sent).toHaveLength(0);
    expect(mem.rows[0]!.state).toBe("active"); // a missing send permission does not stop the reading
    expect(await tool("mail_conversations").handler(ctx(), { mailbox: box!.id })).toBeTruthy();
  });
});

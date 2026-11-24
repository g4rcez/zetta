import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import type { Conversation, MailboxDriver } from "./driver";
import { MailConnectError } from "./imap-connect";
import type { DnsResolver } from "./providers";
import { MAIL_RATE } from "./routes";
import { createMailHarness } from "./routes-harness";

/** The mailbox routes over a real database with a fake mail driver: needs `ZETTA_TEST_DB=embedded` (or a test database URL); skipped without. */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `mbr-a-${uuidv7()}`;
const B = `mbr-b-${uuidv7()}`;
const PASSWORD = "pw-test-not-a-real-password";
const NEW_PASSWORD = "pw-test-new-not-a-real-password";

const body = (over: Record<string, unknown> = {}) => ({
  address: "ana@example.invalid",
  label: "Work",
  imapHost: "imap.example.invalid",
  imapPort: 993,
  smtpHost: "smtp.example.invalid",
  smtpPort: 465,
  user: "ana@example.invalid",
  sealed: { password: PASSWORD },
  ...over,
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const unsafe =
  '<p>Hello</p><script>alert(1)</script><img src="https://track.example.invalid/p.gif" width="1" height="1"><img src="cid:logo@x"><a href="javascript:alert(1)">x</a>';
const conversation: Conversation = {
  id: "conv-1",
  subject: "Hi",
  messages: [
    {
      id: "m-1",
      messageId: "m1@example.invalid",
      origin: "received",
      from: { name: "Rui", address: "rui@example.invalid" },
      to: [{ name: "", address: "ana@example.invalid" }],
      cc: [],
      replyTo: [],
      date: "2026-01-01T10:00:00.000Z",
      subject: "Hi",
      text: "Hello",
      htmlUnsafe: unsafe,
      attachments: [
        {
          id: "m-1.0",
          fileName: "logo.png",
          contentType: "image/png",
          size: PNG.length,
          disposition: "inline",
          contentId: "<logo@x>",
        },
        {
          id: "m-1.1",
          fileName: '..\\evil";name.pdf',
          contentType: "text/html",
          size: 4,
          disposition: "attachment",
          contentId: "",
        },
      ],
      source: "complete",
    },
  ],
};

suite("mailbox routes with a fake mail driver", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  // What the fake driver does next; each test sets it.
  const script: {
    fail?: Error;
    checks: string[];
    passwords: string[];
    /** The number of files each `getAttachments` call asked for. */
    attachmentReads: number[];
  } = {
    checks: [],
    passwords: [],
    attachmentReads: [],
  };
  const driver: MailboxDriver = {
    check: async () => {
      if (script.fail) throw script.fail;
    },
    listConversations: async () => {
      if (script.fail) throw script.fail;
      return {
        conversations: [
          {
            id: "conv-1",
            subject: "Hi",
            participants: [],
            lastDate: "2026-01-01T10:00:00.000Z",
            messageCount: 1,
            snippet: "Hello",
            attachments: "some",
          },
        ],
      };
    },
    getConversation: async () => {
      if (script.fail) throw script.fail;
      return conversation;
    },
    getAttachment: async (_c, aid) => {
      if (script.fail) throw script.fail;
      return aid === "m-1.0"
        ? { fileName: "logo.png", contentType: "image/png", bytes: new Uint8Array(PNG) }
        : {
            fileName: '..\\evil";name.pdf',
            contentType: "text/html",
            bytes: new TextEncoder().encode("<b>x"),
          };
    },
    getAttachments: async (c, ids) => {
      script.attachmentReads.push(ids.length);
      return new Map(
        await Promise.all(ids.map(async (id) => [id, await driver.getAttachment(c, id)] as const)),
      );
    },
    send: async () => ({ messageId: "x", copy: "provider" }),
  };
  const dns: DnsResolver = {
    srv: async () => [],
    mx: async (n) =>
      n === "acme.example.invalid" ? [{ exchange: "aspmx.l.google.com", priority: 1 }] : [],
  };
  const h = createMailHarness(db, {
    dns,
    driverFor: (m, password) => {
      script.checks.push(m.address);
      script.passwords.push(password);
      return driver;
    },
  });
  let botA = "";
  let botB = "";

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
    const mk = async (owner: string, name: string) =>
      (
        await db
          .insert(bot)
          .values({
            ownerUserId: owner,
            kind: "specialist",
            visibility: "private",
            name,
            slug: `${name}-${uuidv7().slice(-8)}`,
          })
          .returning({ id: bot.id })
      )[0]!.id;
    botA = await mk(A, "inbox");
    botB = await mk(B, "theirs");
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });
  beforeEach(async () => {
    delete script.fail;
    script.checks.length = 0;
    script.passwords.length = 0;
    h.resetRoutes(); // fresh rate-limit counters
    for (const who of [A, B]) {
      const r = await h.call(who, "GET", "/api/mailboxes");
      for (const m of r.json.mailboxes) await h.call(who, "DELETE", `/api/mailboxes/${m.id}`);
    }
    h.revoked.length = 0;
    h.closed.length = 0;
    h.opened.length = 0;
  });

  const connect = async (as = A, over: Record<string, unknown> = {}) =>
    h.call(as, "POST", "/api/mailboxes", body(over));

  test("needs a signed-in person and a trusted origin", async () => {
    expect((await h.call(null, "GET", "/api/mailboxes")).status).toBe(401);
    expect((await h.call(null, "POST", "/api/mailboxes", body())).status).toBe(401);
    const r = await h.call(A, "GET", "/api/mailboxes");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  test("validation: plaintext password, bad host, port, address and unknown fields are 400", async () => {
    for (const over of [
      { password: PASSWORD },
      { sealed: { password: PASSWORD, extra: 1 } },
      { sealed: { password: "" } },
      { sealed: undefined },
      { imapHost: "bad host!" },
      { imapHost: "https://x.example.invalid" },
      { imapPort: 0 },
      { smtpPort: 70000 },
      { imapPort: "993" },
      { imapSecurity: "ssl" },
      { address: "nope" },
      { address: "a b@example.invalid" },
      { user: "" },
      { botId: "not-a-uuid" },
      { sending: "yes" },
      { unknown: true },
    ]) {
      const r = await connect(A, over);
      expect([400]).toContain(r.status);
      expect(r.json.error.code).toBeDefined();
    }
    expect(script.checks).toEqual([]);
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
  });

  test("connect checks first, seals the password, and returns neither the password nor the connection id", async () => {
    const r = await connect(A, { botId: botA, allowedSenders: [" Rui@Example.invalid "] });
    expect(r.status).toBe(201);
    expect(script.checks).toEqual(["ana@example.invalid"]);
    expect(script.passwords).toEqual([PASSWORD]);
    expect(h.opened).toEqual([{ userId: A, purpose: "mailbox.connect" }]);
    expect(r.json.mailbox).toMatchObject({
      kind: "imap",
      address: "ana@example.invalid",
      label: "Work",
      state: "active",
      lastError: null,
      sending: "on",
      ownerBotId: botA,
      allowedSenders: ["rui@example.invalid"],
    });
    expect(h.secrets.size).toBe(1);
    const id = [...h.secrets.keys()][0]!;
    expect(r.text).not.toContain(PASSWORD);
    expect(r.text).not.toContain(id);
    expect(r.text).not.toMatch(/connection/i);
    const list = await h.call(A, "GET", "/api/mailboxes");
    expect(list.text).not.toContain(PASSWORD);
    expect(list.text).not.toContain(id);
    expect(list.json.mailboxes).toHaveLength(1);
  });

  test("a failed check saves nothing and answers with the safe sentence", async () => {
    script.fail = new MailConnectError(
      "AUTH",
      "The mail server did not accept the user name and password.",
      "Check them.",
    );
    const r = await connect();
    expect(r.status).toBe(422);
    expect(r.json.error).toEqual({
      code: "AUTH",
      message: "The mail server did not accept the user name and password.",
      fix: "Check them.",
    });
    expect(h.secrets.size).toBe(0);
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    script.fail = new MailConnectError(
      "UNREACHABLE",
      "The mail server could not be reached to sign in.",
    );
    expect((await connect()).status).toBe(502);
    script.fail = new MailConnectError("BLOCKED_URL", "That mail server address is not allowed.");
    expect((await connect()).status).toBe(400);
    // Whatever else is thrown, the server's own words do not reach the answer.
    script.fail = new Error("535 5.7.8 user ana@example.invalid password rejected: hunter2");
    const raw = await connect();
    expect(raw.status).toBe(500);
    expect(raw.text).not.toContain("hunter2");
    expect(h.secrets.size).toBe(0);
  });

  test("the same address twice is 409 and the second sealed password is revoked", async () => {
    expect((await connect()).status).toBe(201);
    const again = await connect();
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("ADDRESS_TAKEN");
    expect(h.secrets.size).toBe(1);
    expect(h.revoked).toHaveLength(1);
  });

  test("another person's mailbox is 404 on every route, and never listed", async () => {
    const id = (await connect(A)).json.mailbox.id as string;
    const b = await h.call(B, "GET", "/api/mailboxes");
    expect(b.json.mailboxes).toEqual([]);
    const secretsBefore = h.secrets.size;
    for (const [method, path, payload] of [
      ["PATCH", `/api/mailboxes/${id}`, { label: "mine now" }],
      ["PATCH", `/api/mailboxes/${id}`, { sealed: { password: NEW_PASSWORD } }],
      ["GET", `/api/mailboxes/${id}/conversations`, undefined],
      ["GET", `/api/mailboxes/${id}/conversations/conv-1`, undefined],
      ["GET", `/api/mailboxes/${id}/conversations/conv-1/attachments/m-1.1`, undefined],
      ["DELETE", `/api/mailboxes/${id}`, undefined],
    ] as const) {
      const r = await h.call(B, method, path, payload);
      expect([method, path, r.status]).toEqual([method, path, 404]);
    }
    expect(h.secrets.size).toBe(secretsBefore);
    const mine = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes[0];
    expect(mine.label).toBe("Work");
    // B may connect the same address on their own; it does not touch A's.
    expect((await connect(B)).status).toBe(201);
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toHaveLength(1);
  });

  test("a driver failure while reading sets the state; a later success clears it; only safe text is stored", async () => {
    const id = (await connect()).json.mailbox.id as string;
    const state = async () => (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes[0];
    const safeAuth = "The mail server did not accept the user name and password.";
    script.fail = new MailConnectError("AUTH", safeAuth, "Check them.");
    expect((await h.call(A, "GET", `/api/mailboxes/${id}/conversations`)).status).toBe(422);
    expect(await state()).toMatchObject({ state: "needs_auth", lastError: safeAuth });
    const safeDown = "The mail server could not be reached to sign in.";
    script.fail = new MailConnectError("UNREACHABLE", safeDown);
    expect((await h.call(A, "GET", `/api/mailboxes/${id}/conversations/conv-1`)).status).toBe(502);
    expect(await state()).toMatchObject({ state: "error", lastError: safeDown });
    // A mistake of the caller (a stale id) says nothing about the mailbox.
    script.fail = new MailConnectError("BAD_ID", "That conversation is not valid any more.");
    expect((await h.call(A, "GET", `/api/mailboxes/${id}/conversations/conv-1`)).status).toBe(404);
    expect(await state()).toMatchObject({ state: "error", lastError: safeDown });
    delete script.fail;
    expect((await h.call(A, "GET", `/api/mailboxes/${id}/conversations`)).status).toBe(200);
    expect(await state()).toMatchObject({ state: "active", lastError: null });
  });

  test("a conversation comes back with clean html, never the unsafe field", async () => {
    const id = (await connect()).json.mailbox.id as string;
    const r = await h.call(A, "GET", `/api/mailboxes/${id}/conversations/conv-1`);
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("htmlUnsafe");
    const msg = r.json.conversation.messages[0];
    expect(msg.text).toBe("Hello");
    expect(msg.html).toContain("<p>Hello</p>");
    expect(msg.html).not.toMatch(/script|alert|track\.example|javascript/i);
    expect(msg.html).toContain("data:image/png;base64,");
    expect(msg.remoteImages).toBe("removed");
    expect(msg.htmlSize).toBe("ok");
    expect(msg.attachments.map((a: any) => a.id)).toEqual(["m-1.0", "m-1.1"]);
    expect(Object.keys(msg.attachments[0]).sort()).toEqual([
      "contentType",
      "disposition",
      "fileName",
      "id",
      "size",
    ]);
    const remote = await h.call(
      A,
      "GET",
      `/api/mailboxes/${id}/conversations/conv-1?images=remote`,
    );
    expect(remote.json.conversation.messages[0].html).toContain(
      'src="https://track.example.invalid/p.gif"',
    );
    expect(remote.json.conversation.messages[0].remoteImages).toBe("shown");
    expect(
      (await h.call(A, "GET", `/api/mailboxes/${id}/conversations/conv-1?images=all`)).status,
    ).toBe(400);
  });

  test("an attachment is a download with fixed headers and a safe file name", async () => {
    const id = (await connect()).json.mailbox.id as string;
    const r = await h.call(A, "GET", `/api/mailboxes/${id}/conversations/conv-1/attachments/m-1.1`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    const disposition = r.headers.get("content-disposition")!;
    expect(disposition).toStartWith("attachment; ");
    expect(disposition).not.toMatch(/[\\]|evil";/);
    expect(disposition).toContain('filename="evil__name.pdf"');
    expect(r.headers.get("content-length")).toBe(String(r.bytes.length));
    expect(r.text).toBe("<b>x");
  });

  test("an attachment over the size cap is refused by the driver and answered 413", async () => {
    const id = (await connect()).json.mailbox.id as string;
    script.fail = new MailConnectError("TOO_LARGE", "That file is too large to open here.");
    const r = await h.call(A, "GET", `/api/mailboxes/${id}/conversations/conv-1/attachments/m-1.1`);
    expect(r.status).toBe(413);
  });

  test("changing label, owner bot, sending and senders; a foreign bot is refused", async () => {
    const id = (await connect()).json.mailbox.id as string;
    const r = await h.call(A, "PATCH", `/api/mailboxes/${id}`, {
      label: " Home ",
      botId: botA,
      sending: "off",
      allowedSenders: ["@example.invalid"],
    });
    expect(r.status).toBe(200);
    expect(r.json.mailbox).toMatchObject({
      label: "Home",
      ownerBotId: botA,
      sending: "off",
      allowedSenders: ["@example.invalid"],
    });
    expect(script.checks).toHaveLength(1); // only the connect: nothing about access changed
    const foreign = await h.call(A, "PATCH", `/api/mailboxes/${id}`, { botId: botB });
    expect(foreign.status).toBe(400);
    expect(foreign.json.error.code).toBe("BAD_REFERENCE");
    expect(
      (await h.call(A, "PATCH", `/api/mailboxes/${id}`, { botId: null })).json.mailbox.ownerBotId,
    ).toBeNull();
    expect(
      (await h.call(A, "PATCH", `/api/mailboxes/${id}`, { address: "x@example.invalid" })).status,
    ).toBe(400);
    expect(
      (await h.call(A, "PATCH", `/api/mailboxes/${id}`, { password: NEW_PASSWORD })).status,
    ).toBe(400);
  });

  test("a new password is re-checked; a failure keeps the old one, a success replaces and revokes it", async () => {
    const id = (await connect()).json.mailbox.id as string;
    const old = [...h.secrets.keys()][0]!;
    script.fail = new MailConnectError(
      "AUTH",
      "The mail server did not accept the user name and password.",
    );
    const bad = await h.call(A, "PATCH", `/api/mailboxes/${id}`, {
      sealed: { password: NEW_PASSWORD },
    });
    expect(bad.status).toBe(422);
    expect([...h.secrets.keys()]).toEqual([old]);
    expect(h.revoked).toEqual([]);
    delete script.fail;
    h.opened.length = 0;
    const ok = await h.call(A, "PATCH", `/api/mailboxes/${id}`, {
      sealed: { password: NEW_PASSWORD },
      imapHost: "imap2.example.invalid",
    });
    expect(ok.status).toBe(200);
    expect(h.opened).toEqual([{ userId: A, purpose: `mailbox.password:${id}` }]);
    expect(script.passwords.at(-1)).toBe(NEW_PASSWORD);
    expect(ok.json.mailbox.servers.imapHost).toBe("imap2.example.invalid");
    expect(ok.json.mailbox.state).toBe("active");
    expect(h.revoked).toEqual([old]);
    expect(h.secrets.has(old)).toBe(false);
    expect(h.secrets.size).toBe(1);
    expect(h.closed).toContain(id);
    expect(ok.text).not.toContain(NEW_PASSWORD);
    // New servers with the saved password: the saved one is what gets checked.
    await h.call(A, "PATCH", `/api/mailboxes/${id}`, { smtpPort: 587, smtpSecurity: "starttls" });
    expect(script.passwords.at(-1)).toBe(NEW_PASSWORD);
  });

  test("removing a mailbox removes its sealed password and closes its connection", async () => {
    const id = (await connect()).json.mailbox.id as string;
    const secret = [...h.secrets.keys()][0]!;
    const r = await h.call(A, "DELETE", `/api/mailboxes/${id}`);
    expect(r.status).toBe(200);
    expect(h.revoked).toEqual([secret]);
    expect(h.closed).toContain(id);
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    expect((await h.call(A, "DELETE", `/api/mailboxes/${id}`)).status).toBe(404);
  });

  test("the password buffer handed to the service is zeroed after use", async () => {
    const id = (await connect()).json.mailbox.id as string;
    h.handedOut.length = 0;
    await h.call(A, "GET", `/api/mailboxes/${id}/conversations`);
    expect(h.handedOut).toHaveLength(1);
    expect(h.handedOut[0]!.every((b) => b === 0)).toBe(true);
  });

  test("a mailbox kind without a driver says it is not available yet", async () => {
    const { createMailboxStore } = await import("./store");
    const row = await createMailboxStore(db).create({ userId: A, isAdmin: false } as never, {
      kind: "provisioned",
      address: "g@example.invalid",
    });
    const r = await h.call(A, "GET", `/api/mailboxes/${row.id}/conversations`);
    expect(r.status).toBe(501);
    expect(r.json.error.code).toBe("NOT_AVAILABLE");
  });

  test("list and open parameters are validated", async () => {
    const id = (await connect()).json.mailbox.id as string;
    expect(
      (await h.call(A, "GET", `/api/mailboxes/${id}/conversations?q=${"x".repeat(201)}`)).status,
    ).toBe(400);
    expect(
      (await h.call(A, "GET", `/api/mailboxes/${id}/conversations?q=hello&cursor=abc`)).status,
    ).toBe(200);
    expect((await h.call(A, "GET", "/api/mailboxes/not-a-uuid/conversations")).status).toBe(400);
  });

  test("detect: a suggestion, bad addresses are 400, signed-in only", async () => {
    expect((await h.call(null, "GET", "/api/mail/detect?address=a@icloud.com")).status).toBe(401);
    const known = await h.call(A, "GET", "/api/mail/detect?address=ana@icloud.com");
    expect(known.status).toBe(200);
    expect(known.json.detection).toMatchObject({
      status: "known",
      imap: { host: "imap.mail.me.com" },
    });
    const g = await h.call(A, "GET", "/api/mail/detect?address=ana@acme.example.invalid");
    expect(g.json.detection.status).toBe("google");
    expect((await h.call(A, "GET", "/api/mail/detect?address=nope")).status).toBe(400);
    expect((await h.call(A, "GET", "/api/mail/detect")).status).toBe(400);
  });

  test("rate limits are per person: connect, detect and attachment", async () => {
    for (let i = 0; i < MAIL_RATE.detect; i++)
      expect((await h.call(A, "GET", "/api/mail/detect?address=a@icloud.com")).status).toBe(200);
    const limited = await h.call(A, "GET", "/api/mail/detect?address=a@icloud.com");
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("RATE_LIMITED");
    expect((await h.call(B, "GET", "/api/mail/detect?address=a@icloud.com")).status).toBe(200);

    // Connect attempts count even when they fail.
    script.fail = new MailConnectError(
      "AUTH",
      "The mail server did not accept the user name and password.",
    );
    for (let i = 0; i < MAIL_RATE.connect; i++) expect((await connect()).status).toBe(422);
    expect((await connect()).status).toBe(429);
    delete script.fail;
    expect((await connect(B)).status).toBe(201);

    const id = (await h.call(B, "GET", "/api/mailboxes")).json.mailboxes[0].id as string;
    for (let i = 0; i < MAIL_RATE.attachment; i++)
      expect(
        (await h.call(B, "GET", `/api/mailboxes/${id}/conversations/conv-1/attachments/m-1.1`))
          .status,
      ).toBe(200);
    expect(
      (await h.call(B, "GET", `/api/mailboxes/${id}/conversations/conv-1/attachments/m-1.1`))
        .status,
    ).toBe(429);
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  addressOf,
  deliver,
  GREENMAIL_ENABLED,
  loginOf,
  startGreenmail,
  withHeaders,
  type Greenmail,
  type TestUser,
} from "../../mail/greenmail-setup";
import { freePort } from "./vault/vault-real-setup";
import { configureMail, configureMailer, MAIL, resetMailLimits } from "./mail";
import type { PluginContext } from "./registry";

/**
 * The `mail` plugin (a channel: listed people write to a bot) driven through its own code against a REAL mail server, GreenMail in a local
 * container: install, status, poll, delivery from an allowed sender, `send_email`, a rebuilt mailbox, a wrong password. Opt-in:
 *
 *   ZETTA_TEST_GREENMAIL=1 ZETTA_DOCKER_BIN=/opt/podman/bin/podman bun --no-env-file test src/modules/integrations/plugins/mail.real.integration.test.ts
 *
 * Before this file existed the plugin had only been tested with a fake IMAP and SMTP (`mail.test.ts`). GreenMail adds no
 * Authentication-Results header, so the "server vouches for the sender" check is exercised by writing that header into the message, which
 * is what a receiving server does.
 */
setDefaultTimeout(120_000);

const BOT: TestUser = { login: "bot", password: "bot-pass-test" };
const ANA: TestUser = { login: "ana", password: "ana-pass-test" };
const EVE: TestUser = { login: "eve", password: "eve-pass-test" };
const BOT_ADDR = addressOf(BOT),
  ANA_ADDR = addressOf(ANA),
  EVE_ADDR = addressOf(EVE);
const PASS =
  "mx.example.invalid; dkim=pass header.i=@example.invalid; spf=pass smtp.mailfrom=ana@example.invalid";
const SERVER = "mx.example.invalid";

const describeOrSkip = GREENMAIL_ENABLED ? describe : describe.skip;

describeOrSkip("the mail plugin against a real GreenMail server", () => {
  let g: Greenmail;
  const ctx = (over: Record<string, string> = {}): PluginContext => ({
    userId: "u1",
    config: {
      imapHost: "127.0.0.1",
      imapPort: String(g.imapPort),
      smtpHost: "127.0.0.1",
      smtpPort: String(g.smtpPort),
      user: loginOf(BOT),
      password: BOT.password,
      allowedSenders: ANA_ADDR,
      receivingServer: SERVER,
      allowSend: "yes",
      ...over,
    },
    setConfig: () => {
      throw new Error("poll must not call setConfig");
    },
  });
  const poll = (c: PluginContext, cursor: unknown, maxEvents = 50) =>
    MAIL.inbound!.poll(c, cursor, {
      filter: { direct: true, groups: false, chats: [] },
      maxEvents,
    });
  const tool = (name: string) => MAIL.tools!.find((t) => t.name === name)!;
  const failure = async (work: Promise<unknown>) =>
    (await work.then(
      () => undefined,
      (e) => e,
    )) as { code: string; safe: string; fix?: string; message: string } | undefined;

  const asPerson = async <T>(u: TestUser, fn: (c: ImapFlow) => Promise<T>) => {
    const c = new ImapFlow({
      host: "127.0.0.1",
      port: g.imapPort,
      secure: false,
      auth: { user: loginOf(u), pass: u.password },
      logger: false,
    });
    c.on("error", () => {});
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.logout().catch(() => c.close());
    }
  };
  const flagsOf = (u: TestUser) =>
    asPerson(u, async (c) => {
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      try {
        const out: Record<number, string> = {};
        for await (const m of c.fetch("1:*", { uid: true, flags: true }, { uid: true }))
          out[m.uid] = [...(m.flags ?? [])]
            .filter((f) => f !== "\\Recent")
            .sort()
            .join(" ");
        return out;
      } finally {
        lock.release();
      }
    });
  const inboxOf = (u: TestUser) =>
    asPerson(u, async (c) => {
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      try {
        const out = [];
        for await (const m of c.fetch("1:*", { source: true }, { uid: false }))
          out.push(await simpleParser(m.source as Buffer));
        return out;
      } finally {
        lock.release();
      }
    });

  const fromAna = (subject: string, body: string, headers: Record<string, string> = {}) =>
    deliver(g, {
      from: `Ana Souza <${ANA_ADDR}>`,
      to: BOT_ADDR,
      subject,
      body,
      headers: { "Authentication-Results": PASS, ...headers },
    });

  type Cur = { v: 1; uidValidity: string; lastUid: number };
  let cursor: Cur;

  beforeAll(async () => {
    configureMail({ allowPrivate: true });
    configureMailer(undefined); // the real IMAP and SMTP, not the fakes of mail.test.ts
    resetMailLimits();
    g = await startGreenmail([BOT, ANA, EVE]);
  });
  afterAll(async () => {
    await g?.stop();
    configureMail({ allowPrivate: false });
  });

  test("install, connect and status sign in to both servers", async () => {
    await expect(MAIL.install!(ctx())).resolves.toBeUndefined();
    expect(await MAIL.connect!(ctx())).toMatchObject({ message: "Connected." });
    expect(await MAIL.status!(ctx())).toMatchObject({
      state: "connected",
      info: { address: BOT_ADDR, allowSend: true },
    });
  });

  test("the first poll only remembers where the mailbox is: nothing from before is delivered", async () => {
    await fromAna("Old news", "Written before the bot was listening.");
    const first = await poll(ctx(), null);
    expect(first.events).toEqual([]);
    cursor = first.cursor as Cur;
    expect(cursor).toMatchObject({ v: 1, lastUid: 1 });
    expect(cursor.uidValidity).toMatch(/^\d+$/);
  });

  test("a message from an allowed sender that the server vouches for is delivered once; the others are not", async () => {
    await fromAna(
      "Invoice question",
      "Hello bot,\r\ncan you check the invoice?\r\n\r\n> an old quoted line",
      {
        "Message-ID": "<inv1@seed.example.invalid>",
        Date: "Tue, 14 Nov 2023 22:13:20 +0000",
      },
    );
    // Not allowed: a stranger, even with a passing header.
    await deliver(g, {
      from: `Eve <${EVE_ADDR}>`,
      to: BOT_ADDR,
      subject: "Let me in",
      body: "Please.",
      headers: { "Authentication-Results": PASS },
    });
    // Allowed, but nobody vouches for it.
    await fromAna("Unvouched", "No header.", {
      "Authentication-Results": "mx.example.invalid; dkim=none",
    });
    // Allowed and vouched, but an automatic message: a machine, never answered.
    await fromAna("Away", "I am out.", { "Auto-Submitted": "auto-replied" });
    const before = await flagsOf(BOT);
    const r = await poll(ctx(), cursor);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      key: "<inv1@seed.example.invalid>",
      chat: ANA_ADDR,
      chatName: "Ana Souza",
      from: "Ana Souza",
      media: false,
      group: false,
      at: Date.parse("2023-11-14T22:13:20Z"),
    });
    expect(r.events[0]!.text).toBe(
      "Subject: Invoice question\n\nHello bot,\ncan you check the invoice?",
    );
    expect((r.cursor as Cur).lastUid).toBe(cursor.lastUid + 4);
    cursor = r.cursor as Cur;
    expect((await poll(ctx(), cursor)).events).toEqual([]);
    // Reading never marks anything as read.
    expect(await flagsOf(BOT)).toEqual(before);
  });

  test("with 'Check the sender' off, an allowed sender is delivered without the header", async () => {
    await deliver(g, {
      from: `Ana Souza <${ANA_ADDR}>`,
      to: BOT_ADDR,
      subject: "Private server",
      body: "No header here.",
    });
    const strict = await poll(ctx(), cursor);
    expect(strict.events).toEqual([]);
    // That message was looked at and left behind; a new one is delivered when the check is off.
    cursor = strict.cursor as Cur;
    await deliver(g, {
      from: `Ana Souza <${ANA_ADDR}>`,
      to: BOT_ADDR,
      subject: "Private server 2",
      body: "No header here either.",
    });
    const lax = await poll(ctx({ requireAuth: "no" }), cursor);
    expect(lax.events.map((e) => e.text)).toEqual([
      "Subject: Private server 2\n\nNo header here either.",
    ]);
    cursor = lax.cursor as Cur;
  });

  test("a page that is full is read on over the next polls, each message once", async () => {
    for (const n of [1, 2, 3]) await fromAna(`Batch ${n}`, `Body ${n}`);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await poll(ctx(), cursor, 1);
      seen.push(...r.events.map((e) => e.text));
      cursor = r.cursor as Cur;
      if (!r.events.length) break;
    }
    expect(seen).toEqual([
      "Subject: Batch 1\n\nBody 1",
      "Subject: Batch 2\n\nBody 2",
      "Subject: Batch 3\n\nBody 3",
    ]);
  });

  test("an HTML message with a file: the words are read, the file is named and never opened", async () => {
    const head = {
      from: `Ana Souza <${ANA_ADDR}>`,
      to: BOT_ADDR,
      subject: "With a file",
      headers: { "Authentication-Results": PASS },
    };
    await deliver(g, {
      ...head,
      mime: withHeaders(
        head,
        'Content-Type: multipart/mixed; boundary="mix"',
        [
          "--mix",
          "Content-Type: text/html; charset=utf-8",
          "",
          "<p>See the <b>attached</b> report.</p><script>steal()</script>",
          "--mix",
          'Content-Type: application/pdf; name="report.pdf"',
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: attachment; filename="report.pdf"',
          "",
          Buffer.from("%PDF-1.4").toString("base64"),
          "--mix--",
          "",
        ].join("\r\n"),
      ),
    });
    const r = await poll(ctx(), cursor);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.media).toBe(true);
    expect(r.events[0]!.text).toContain("See the attached report.");
    expect(r.events[0]!.text).not.toContain("steal()");
    expect(r.events[0]!.text).toContain("(attachments not opened: report.pdf)");
    cursor = r.cursor as Cur;
  });

  test("no allowed senders: nothing is delivered and the person is told", async () => {
    await fromAna("Nobody listens", "Hi.");
    const r = await poll(ctx({ allowedSenders: "" }), cursor);
    expect(r.events).toEqual([]);
    expect((r as { warning?: string }).warning).toContain("No allowed senders");
    cursor = r.cursor as Cur;
  });

  test("send_email delivers a plain text message from the bot to an allowed address", async () => {
    const out = (await tool("send_email").handler(ctx(), {
      to: ANA_ADDR.toUpperCase(),
      subject: "Re: Invoice question\r\nBcc: eve@example.invalid",
      text: "The invoice is fine.\n\nThanks!",
    })) as { sent: boolean; to: string; messageId: string };
    expect(out).toMatchObject({ sent: true, to: ANA_ADDR });
    const mails = await inboxOf(ANA);
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.from?.value[0]?.address).toBe(BOT_ADDR);
    expect(m.to).toMatchObject({ value: [{ address: ANA_ADDR }] });
    // The line break in the subject became a space: no second header, no copy to Eve.
    expect(m.subject).toBe("Re: Invoice question Bcc: eve@example.invalid");
    expect(m.headers.get("bcc")).toBeUndefined();
    expect(m.text?.trim()).toBe("The invoice is fine.\n\nThanks!");
    expect(m.messageId).toBe(out.messageId);
    expect(await inboxOf(EVE)).toHaveLength(0);
  });

  test("send_email refuses what the plugin forbids", async () => {
    expect(
      await failure(tool("send_email").handler(ctx(), { to: EVE_ADDR, text: "hi" })),
    ).toMatchObject({ code: "NOT_ALLOWED" });
    expect(
      await failure(
        tool("send_email").handler(ctx({ allowSend: "no" }), { to: ANA_ADDR, text: "hi" }),
      ),
    ).toMatchObject({ code: "SEND_DISABLED" });
    expect(
      await failure(
        tool("send_email").handler(ctx(), {
          to: "a@example.invalid, eve@example.invalid",
          text: "hi",
        }),
      ),
    ).toMatchObject({ code: "INVALID_ARGS" });
    expect(await inboxOf(EVE)).toHaveLength(0);
  });

  test("a wrong password is a safe error, and the person is told to sign in again", async () => {
    const wrong = ctx({ password: "not-the-password-test" });
    const e = await failure(poll(wrong, cursor));
    expect(e).toMatchObject({ code: "AUTH" });
    for (const s of [e!.message, e!.safe, e!.fix ?? ""]) {
      expect(s).not.toContain("not-the-password-test");
      expect(s).not.toContain(BOT_ADDR);
    }
    expect(e!.fix).toContain("install the plugin again");
    expect(await failure(MAIL.install!(wrong))).toMatchObject({ code: "AUTH" });
    expect(await MAIL.status!(wrong)).toMatchObject({ state: "needs-auth" });
    expect(
      await failure(tool("send_email").handler(wrong, { to: ANA_ADDR, text: "hi" })),
    ).toMatchObject({ code: "AUTH" });
  });

  test("a server that is not there is UNREACHABLE for reading and for sending", async () => {
    const dead = String(freePort());
    expect(await failure(poll(ctx({ imapPort: dead }), cursor))).toMatchObject({
      code: "UNREACHABLE",
    });
    expect(
      await failure(
        tool("send_email").handler(ctx({ smtpPort: dead }), { to: ANA_ADDR, text: "hi" }),
      ),
    ).toMatchObject({ code: "UNREACHABLE" });
    expect(await MAIL.status!(ctx({ imapPort: dead }))).toMatchObject({ state: "error" });
  });

  test("a mailbox the server rebuilt starts again from now, and then delivers new mail", async () => {
    expect(cursor.lastUid).toBeGreaterThan(3);
    await g.restart();
    const r = await poll(ctx(), cursor);
    expect(r.events).toEqual([]);
    expect((r as { warning?: string }).warning).toContain("rebuilt");
    const next = r.cursor as Cur;
    expect(next.uidValidity).not.toBe(cursor.uidValidity);
    expect(next.lastUid).toBe(0);
    await fromAna("After the rebuild", "Anyone there?");
    const after = await poll(ctx(), next);
    expect(after.events.map((e) => e.text)).toEqual([
      "Subject: After the rebuild\n\nAnyone there?",
    ]);
    expect((after.cursor as Cur).lastUid).toBe(1);
  });
});

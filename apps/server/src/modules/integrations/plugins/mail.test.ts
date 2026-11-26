import { beforeEach, describe, expect, test } from "bun:test";
import { vouched } from "./authres";
import {
  allowedList,
  configureMail,
  configureMailer,
  MAIL,
  resetMailLimits,
  senderAllowed,
  toEvent,
  type Fetched,
  type Mailer,
  type Outgoing,
  type RawMail,
} from "./mail";
import type { PluginContext } from "./registry";

const mime = (headers: Record<string, string>, body: string) =>
  new TextEncoder().encode(
    `${Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n")}\r\n\r\n${body}`,
  );
const PASS =
  "mx.example.net; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=ana@example.com; dmarc=pass header.from=example.com";
const mail = (
  uid: number,
  over: Record<string, string> = {},
  body = "Hello bot,\r\ncan you check the invoice?",
) => ({
  uid,
  source: mime(
    {
      From: "Ana Souza <ana@example.com>",
      To: "bot@example.org",
      Subject: "Invoice question",
      "Message-ID": `<m${uid}@example.com>`,
      Date: "Tue, 14 Nov 2023 22:13:20 +0000",
      "Authentication-Results": PASS,
      "Content-Type": "text/plain; charset=utf-8",
      ...over,
    },
    body,
  ),
});
const opts = {
  allowed: ["ana@example.com"],
  server: "mx.example.net",
  strict: true,
  self: "bot@example.org",
};

describe("who may write", () => {
  test("a list holds addresses and domains, in any case, and matching is exact for an address and by domain for a domain", () => {
    expect(allowedList(" Ana@Example.com, @example.org;example.net ")).toEqual([
      "ana@example.com",
      "@example.org",
      "example.net",
    ]);
    const list = allowedList("ana@example.com, @example.org, example.net");
    expect(senderAllowed("ANA@example.com", list)).toBe(true);
    expect(senderAllowed("eve@example.com", list)).toBe(false);
    expect(senderAllowed("x@example.org", list)).toBe(true);
    expect(senderAllowed("x@example.net", list)).toBe(true);
    expect(senderAllowed("x@evil-example.org", list)).toBe(false);
    expect(senderAllowed("x@sub.example.org", list)).toBe(false);
    expect(senderAllowed("ana@example.com", [])).toBe(false);
  });
});

describe("the receiving server vouches for a sender", () => {
  const says = (...headers: string[]) => vouched(headers, "mx.example.net", "example.com");

  test("with its own verdict: DMARC for the From domain, or a DKIM signature of that domain", () => {
    expect(says(PASS)).toBe(true);
    expect(says("MX.Example.Net 1; dmarc=pass (p=NONE) header.from=Example.com")).toBe(true);
    expect(says("mx.example.net; dkim=pass header.d=example.com header.s=a")).toBe(true);
    expect(
      says(
        "mx.example.net;\r\n\tdkim=fail header.d=other.test;\r\n\tdkim=pass header.i=@example.com",
      ),
    ).toBe(true);
  });

  test("never for another domain, another method or a failure", () => {
    expect(says("mx.example.net; spf=pass smtp.mailfrom=ana@example.com")).toBe(false);
    expect(says("mx.example.net; dkim=pass header.d=attacker.test")).toBe(false);
    expect(says("mx.example.net; dkim=pass header.i=@sub.attacker.test")).toBe(false);
    expect(says("mx.example.net; dmarc=pass header.from=attacker.test")).toBe(false);
    expect(says("mx.example.net; dmarc=pass")).toBe(false);
    expect(
      says("mx.example.net; dkim=fail header.d=example.com; dmarc=fail header.from=example.com"),
    ).toBe(false);
    expect(says("mx.example.net; none")).toBe(false);
    expect(says()).toBe(false);
  });

  test("only that server's header counts, and the topmost one of its name", () => {
    const forged = "mx.example.net; dmarc=pass header.from=example.com";
    expect(says("x; dkim=pass header.d=example.com; dmarc=pass header.from=example.com")).toBe(
      false,
    );
    expect(says("mx.example.net; dmarc=fail header.from=example.com", forged)).toBe(false);
    expect(says("filter.example.org; spf=pass", forged)).toBe(true);
  });

  test("a verdict written inside a comment or a quoted address is not a verdict", () => {
    expect(
      says(
        'mx.example.net; spf=pass smtp.mailfrom="a; dmarc=pass header.from=example.com"@attacker.test; dmarc=fail header.from=example.com',
      ),
    ).toBe(false);
    expect(says("mx.example.net; spf=fail (; dmarc=pass (nested) header.from=example.com)")).toBe(
      false,
    );
    expect(
      says(
        'mx.example.net; spf=pass smtp.mailfrom="unterminated; dmarc=pass header.from=example.com',
      ),
    ).toBe(false);
    expect(says("mx.example.net (unterminated; dmarc=pass header.from=example.com")).toBe(false);
  });
});

describe("one message becomes an outside person's message", () => {
  test("the subject and the new words are the text, the sender is the chat, the message id is the key", async () => {
    const e = await toEvent(mail(7), "42", opts);
    expect(e).toMatchObject({
      key: "<m7@example.com>",
      chat: "ana@example.com",
      chatName: "Ana Souza",
      from: "Ana Souza",
      at: Date.parse("2023-11-14T22:13:20Z"),
      group: false,
      media: false,
    });
    expect(e!.text).toBe("Subject: Invoice question\n\nHello bot,\ncan you check the invoice?");
  });

  test("a quoted thread below the new words, and quoted lines, are left out", async () => {
    const e = await toEvent(
      mail(
        8,
        {},
        "Yes, go ahead.\r\n\r\nOn Mon, 13 Nov 2023, Bot <bot@example.org> wrote:\r\n> earlier question\r\n> more",
      ),
      "42",
      opts,
    );
    expect(e!.text).toBe("Subject: Invoice question\n\nYes, go ahead.");
  });

  test("HTML-only mail is read as text; a long message is cut; an attachment is listed, never opened", async () => {
    const html = await toEvent(
      mail(9, { "Content-Type": "text/html" }, "<style>p{}</style><p>Hello <b>there</b></p>"),
      "42",
      opts,
    );
    expect(html!.text).toContain("Hello there");
    expect(html!.text).not.toContain("<");
    const long = await toEvent(mail(10, {}, "x".repeat(5000)), "42", opts);
    expect(long!.text.length).toBeLessThanOrEqual(2000);
    const withFile = await toEvent(
      {
        uid: 11,
        source: mime(
          {
            From: "ana@example.com",
            Subject: "files",
            "Authentication-Results": PASS,
            "Content-Type": 'multipart/mixed; boundary="b"',
          },
          '--b\r\nContent-Type: text/plain\r\n\r\nSee attached\r\n--b\r\nContent-Type: application/pdf; name="invoice.pdf"\r\nContent-Disposition: attachment; filename="invoice.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--b--\r\n',
        ),
      },
      "42",
      opts,
    );
    expect(withFile!.text).toContain("See attached");
    expect(withFile!.text).toContain("(attachments not opened: invoice.pdf)");
    expect(withFile!.media).toBe(true);
  });

  test("a sender that is not allowed, a server that does not vouch for it, our own address, and automatic mail are all ignored", async () => {
    expect(await toEvent(mail(12, { From: "eve@evil.test" }), "42", opts)).toBeUndefined();
    expect(
      await toEvent(mail(13, { "Authentication-Results": "mx; dkim=fail; spf=fail" }), "42", opts),
    ).toBeUndefined();
    expect(await toEvent(mail(14, { "Authentication-Results": "" }), "42", opts)).toBeUndefined();
    // A header the sender wrote, below the real one or alone under another name.
    expect(
      await toEvent(
        mail(22, {
          "Authentication-Results": `mx.example.net; dmarc=fail header.from=example.com\r\nAuthentication-Results: ${PASS}`,
        }),
        "42",
        opts,
      ),
    ).toBeUndefined();
    expect(
      await toEvent(mail(23, { "Authentication-Results": "x; dkim=pass" }), "42", opts),
    ).toBeUndefined();
    // Two From lines: which one the server checked is not known.
    expect(
      await toEvent(mail(24, { From: "ana@example.com\r\nFrom: eve@attacker.test" }), "42", opts),
    ).toBeUndefined();
    // Without the server's name nothing can be checked.
    expect(await toEvent(mail(25), "42", { ...opts, server: undefined })).toBeUndefined();
    expect(
      await toEvent(mail(15, { From: "bot@example.org" }), "42", {
        ...opts,
        allowed: ["@example.org"],
      }),
    ).toBeUndefined();
    expect(
      await toEvent(mail(16, { "Auto-Submitted": "auto-replied" }), "42", opts),
    ).toBeUndefined();
    expect(await toEvent(mail(17, { Precedence: "bulk" }), "42", opts)).toBeUndefined();
    // A server the person trusts without the header: the check can be off.
    expect(
      await toEvent(mail(18, { "Authentication-Results": "" }), "42", { ...opts, strict: false }),
    ).toBeDefined();
    // Something that is not an e-mail at all.
    expect(
      await toEvent({ uid: 19, source: new Uint8Array([0, 1, 2]) }, "42", opts),
    ).toBeUndefined();
  });

  test("a message with no id gets one from the mailbox, so it is read once", async () => {
    const m = mail(20);
    const noId = {
      uid: 20,
      source: mime(
        { From: "ana@example.com", Subject: "no id", "Authentication-Results": PASS },
        "hi",
      ),
    };
    expect((await toEvent(noId, "42", opts))!.key).toBe("42:20");
    expect(m.uid).toBe(20);
  });
});

// ---- the plugin with a fake mailbox ---------------------------------------------------------------------------------------------------
let box: { uidValidity: string; uidNext: number; mails: RawMail[] };
const fetches: (number | null)[] = [];
const sent: Outgoing[] = [];
let failWith: unknown;
const fake: Mailer = {
  async fetch(_cfg, after, limit): Promise<Fetched> {
    fetches.push(after);
    if (failWith) throw failWith;
    return {
      uidValidity: box.uidValidity,
      uidNext: box.uidNext,
      mails: after === null ? [] : box.mails.filter((m) => m.uid > after).slice(0, limit),
    };
  },
  async send(_cfg, m) {
    if (failWith) throw failWith;
    sent.push(m);
    return { messageId: "<sent@example.org>" };
  },
  async check() {
    if (failWith) throw failWith;
  },
};
const ctx = (over: Record<string, string> = {}): PluginContext => ({
  userId: "u1",
  config: {
    imapHost: "imap.example.org",
    smtpHost: "smtp.example.org",
    user: "bot@example.org",
    password: "app-password",
    allowedSenders: "ana@example.com",
    receivingServer: "mx.example.net",
    ...over,
  },
  setConfig: () => {
    throw new Error("poll must not call setConfig");
  },
});
const poll = (c: PluginContext, cursor: unknown, maxEvents = 50) =>
  MAIL.inbound!.poll(c, cursor, { filter: { direct: true, groups: false, chats: [] }, maxEvents });
const tool = (name: string) => MAIL.tools!.find((t) => t.name === name)!;
beforeEach(() => {
  box = { uidValidity: "42", uidNext: 5, mails: [] };
  fetches.length = 0;
  sent.length = 0;
  failWith = undefined;
  resetMailLimits();
  configureMail({ allowPrivate: true });
  configureMailer(fake);
});

describe("reading the mailbox", () => {
  test("the first look only remembers where the mailbox is; later polls deliver new messages from allowed people once", async () => {
    box.mails = [mail(4)];
    const first = await poll(ctx(), null);
    expect(first.events).toEqual([]);
    expect(first.cursor).toEqual({ v: 1, uidValidity: "42", lastUid: 4 });
    box.uidNext = 8;
    box.mails.push(mail(5), mail(6, { From: "eve@evil.test" }), mail(7));
    const next = await poll(ctx(), first.cursor);
    expect(next.events.map((e) => e.key)).toEqual(["<m5@example.com>", "<m7@example.com>"]);
    expect(next.cursor).toEqual({ v: 1, uidValidity: "42", lastUid: 7 });
    expect(fetches).toEqual([null, 4]);
    expect((await poll(ctx(), next.cursor)).events).toEqual([]);
  });

  test("a mailbox that was rebuilt starts again from now and says so", async () => {
    box = { uidValidity: "99", uidNext: 3, mails: [mail(1), mail(2)] };
    const r = await poll(ctx(), { v: 1, uidValidity: "42", lastUid: 10 });
    expect(r.events).toEqual([]);
    expect(r.cursor).toEqual({ v: 1, uidValidity: "99", lastUid: 2 });
    expect(r.warning).toContain("rebuilt");
  });

  test("with no allowed senders nothing is delivered, and the person is told why; a full page is read on over the next polls", async () => {
    box.uidNext = 4;
    box.mails = [mail(1), mail(2), mail(3)];
    const none = await poll(ctx({ allowedSenders: "" }), { v: 1, uidValidity: "42", lastUid: 0 });
    expect(none.events).toEqual([]);
    expect(none.warning).toContain("No allowed senders");
    const page = await poll(ctx(), { v: 1, uidValidity: "42", lastUid: 0 }, 2);
    expect(page.events).toHaveLength(2);
    expect((page.cursor as { lastUid: number }).lastUid).toBe(2);
    expect((await poll(ctx(), page.cursor, 2)).events.map((e) => e.key)).toEqual([
      "<m3@example.com>",
    ]);
  });

  test("without the receiving server's name nothing is delivered, and the person is told what to do", async () => {
    box.uidNext = 6;
    box.mails = [mail(5)];
    const r = await poll(ctx({ receivingServer: "" }), { v: 1, uidValidity: "42", lastUid: 0 });
    expect(r.events).toEqual([]);
    expect(r.warning).toContain("Receiving server name");
    // With the check off the name is not needed.
    const lax = await poll(ctx({ receivingServer: "", requireAuth: "no" }), {
      v: 1,
      uidValidity: "42",
      lastUid: 0,
    });
    expect(lax.events).toHaveLength(1);
  });

  test("mail from an allowed sender that the server did not vouch for is counted in a warning", async () => {
    box.uidNext = 7;
    box.mails = [mail(5, { "Authentication-Results": "x; dkim=pass" }), mail(6)];
    const r = await poll(ctx(), { v: 1, uidValidity: "42", lastUid: 0 });
    expect(r.events).toHaveLength(1);
    expect(r.warning).toContain("1 message");
  });

  test("a server that cannot be reached or refuses the password is told in words, with no server text", async () => {
    failWith = Object.assign(
      new Error("getaddrinfo ENOTFOUND imap.example.org user=bot@example.org"),
      { code: "ENOTFOUND" },
    );
    await expect(poll(ctx(), null)).rejects.toMatchObject({ code: "UNREACHABLE" });
    failWith = Object.assign(new Error("Invalid credentials for bot@example.org"), {
      authenticationFailed: true,
    });
    const e = await poll(ctx(), null).catch((x) => x);
    expect(e).toMatchObject({ code: "AUTH" });
    expect(`${e.safe} ${e.message}`).not.toContain("bot@example.org");
  });

  test("a mail server on a private network is refused unless the administrator allowed it", async () => {
    configureMail({ allowPrivate: false });
    await expect(poll(ctx({ imapHost: "localhost" }), null)).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
    await expect(poll(ctx({ smtpHost: "mail.internal" }), null)).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
  });

  test("settings that cannot be right are refused: a bad host or port, a missing password", async () => {
    await expect(poll(ctx({ imapHost: "bad host!" }), null)).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
    await expect(poll(ctx({ imapPort: "99999" }), null)).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
    await expect(poll(ctx({ password: "" }), null)).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
  });
});

describe("replying", () => {
  test("it is off until allowed, then goes as plain text to the address that wrote and nobody else", async () => {
    await expect(
      tool("send_email").handler(ctx(), { to: "ana@example.com", text: "hi" }),
    ).rejects.toMatchObject({ code: "SEND_DISABLED" });
    const c = ctx({ allowSend: "yes" });
    const out = await tool("send_email").handler(c, {
      to: "Ana@Example.com",
      subject: "Re: Invoice\r\nBcc: eve@evil.test",
      text: "Yes, it is paid.",
    });
    expect(out).toEqual({ sent: true, to: "ana@example.com", messageId: "<sent@example.org>" });
    expect(sent).toEqual([
      {
        from: "bot@example.org",
        to: "ana@example.com",
        subject: "Re: Invoice Bcc: eve@evil.test",
        text: "Yes, it is paid.",
      },
    ]);
    // Not an address on the list, more than one address, or something that is not an address.
    for (const to of [
      "eve@evil.test",
      "ana@example.com, eve@evil.test",
      "ana@example.com\nBcc: eve@evil.test",
      "nobody",
    ])
      await expect(tool("send_email").handler(c, { to, text: "hi" })).rejects.toBeDefined();
    expect(sent).toHaveLength(1);
  });

  test("replies are limited, empty or oversized text is refused, and a send failure says what to do", async () => {
    const c = ctx({ allowSend: "yes" });
    for (let i = 0; i < 5; i++)
      await tool("send_email").handler(c, { to: "ana@example.com", text: `m${i}` });
    await expect(
      tool("send_email").handler(c, { to: "ana@example.com", text: "one more" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    resetMailLimits();
    await expect(
      tool("send_email").handler(c, { to: "ana@example.com", text: " " }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(
      tool("send_email").handler(c, { to: "ana@example.com", text: "x".repeat(20_001) }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    failWith = Object.assign(new Error("535 5.7.8 bad credentials"), { code: "EAUTH" });
    await expect(
      tool("send_email").handler(c, { to: "ana@example.com", text: "hi" }),
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  test("the reply tool takes the chat as its address, so a bot answering one person cannot write to another", () => {
    expect(MAIL.inbound!.reply).toMatchObject({ tool: "send_email", chatArg: "to" });
    expect(MAIL.inbound!.reply.normalize(" Ana@Example.COM ")).toBe("ana@example.com");
    expect(MAIL.tools!.map((t) => t.name)).toEqual(["status", "send_email"]);
    expect(tool("status").effect).toBe("read");
  });

  test("install checks the settings and the connection; allowed senders are validated when saved", async () => {
    await expect(MAIL.install!(ctx({ allowSend: "maybe" }))).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
    await MAIL.install!(ctx());
    failWith = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    await expect(MAIL.install!(ctx())).rejects.toMatchObject({ code: "UNREACHABLE" });
    failWith = undefined;
    let saved: Record<string, string> | undefined;
    const c: PluginContext = { ...ctx(), setConfig: async (n) => void (saved = n) };
    await MAIL.connect!(c, {
      settings: { allowedSenders: "Ana@Example.com, @example.org", allowSend: true },
    });
    expect(saved).toMatchObject({
      allowedSenders: "ana@example.com, @example.org",
      allowSend: "yes",
    });
    await expect(
      MAIL.connect!(c, { settings: { allowedSenders: "not an address" } }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    expect((await MAIL.status!(ctx())).state).toBe("connected");
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Conversation, ConversationSummary, MailboxDriver } from "./driver";
import { createImapDriver, closeImapPool, imapPoolStats } from "./drivers/imap";
import {
  addressOf,
  deliver,
  GREENMAIL_ENABLED,
  loginOf,
  startGreenmail,
  withHeaders,
  type Greenmail,
  type TestUser,
} from "./greenmail-setup";
import { configureMailPolicy } from "./imap-connect";

/**
 * The IMAP and SMTP mailbox driver against a REAL mail server: GreenMail in a local container. Opt-in, never part of the default run:
 *
 *   ZETTA_TEST_GREENMAIL=1 ZETTA_DOCKER_BIN=/opt/podman/bin/podman bun --no-env-file test src/modules/mail/imap.integration.test.ts
 *
 * `ZETTA_DOCKER_BIN` names the engine binary (Bun cannot spawn a shell function or alias, so give a path on a Mac); the image is pulled on
 * first use. The container is named `zetta-greenmail-<random tail>` and removed afterwards.
 *
 * GreenMail has no `\Sent` special-use folder, no THREAD extension and no STARTTLS, so those paths are covered by unit tests only. It does
 * serve a folder called "Sent", which is what the sent-folder lookup falls back to.
 */
setDefaultTimeout(120_000);

const BOT: TestUser = { login: "bot", password: "bot-pass-test" };
const ANA: TestUser = { login: "ana", password: "ana-pass-test" };
const BEN: TestUser = { login: "ben", password: "ben-pass-test" };
const BOT_ADDR = addressOf(BOT),
  ANA_ADDR = addressOf(ANA);
const RUI = "Rui Costa <rui@example.invalid>";
const ANA_FULL = `Ana Souza <${ANA_ADDR}>`;

const DAY = 86_400_000;
const NOW = Date.now();
const at = (days: number, hours = 10) =>
  new Date(NOW + days * DAY + hours * 3_600_000 - 12 * 3_600_000).toUTCString();
const mid = (n: string) => `<${n}@seed.example.invalid>`;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const wrap = (b: Buffer) => b.toString("base64").replace(/.{76}/g, "$&\r\n");

const describeOrSkip = GREENMAIL_ENABLED ? describe : describe.skip;

describeOrSkip("the IMAP mailbox against a real GreenMail server", () => {
  let g: Greenmail;
  let bot: MailboxDriver;
  const driverFor = (u: TestUser, extra: { idleMs?: number; key?: string } = {}) =>
    createImapDriver({
      key: extra.key ?? `test-${u.login}`,
      address: addressOf(u),
      server: {
        imapHost: "127.0.0.1",
        imapPort: g.imapPort,
        smtpHost: "127.0.0.1",
        smtpPort: g.smtpPort,
        user: loginOf(u),
        password: u.password,
      },
      ...(extra.idleMs ? { idleMs: extra.idleMs } : {}),
    });

  /** A person's own mail program: a plain connection to the mailbox that may change it (the driver never may). */
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

  const all = async (d = bot, query?: string) =>
    (await d.listConversations({ limit: 50, query })).conversations;
  const bySubject = (list: ConversationSummary[], subject: string, count?: number) =>
    list.find((c) => c.subject === subject && (count === undefined || c.messageCount === count))!;

  beforeAll(async () => {
    configureMailPolicy({ allowPrivate: true });
    g = await startGreenmail([BOT, ANA, BEN]);
    bot = driverFor(BOT);
    const to = BOT_ADDR;
    const m = (
      from: string,
      subject: string,
      id: string | undefined,
      headers: Record<string, string>,
      body: string,
      day: number,
      hour = 10,
    ) =>
      deliver(g, {
        from,
        to,
        subject,
        body,
        headers: { ...(id ? { "Message-ID": mid(id) } : {}), Date: at(day, hour), ...headers },
      });
    // A reply chain of three.
    await m(ANA_FULL, "Project kickoff", "a1", {}, "Let us start the kickoff on Monday.", -5, 10);
    await m(
      RUI,
      "Re: Project kickoff",
      "a2",
      { "In-Reply-To": mid("a1"), References: mid("a1") },
      "Monday works for me.",
      -5,
      11,
    );
    await m(
      ANA_FULL,
      "Re: Project kickoff",
      "a3",
      { "In-Reply-To": mid("a2"), References: `${mid("a1")}\r\n ${mid("a2")}` },
      "Great, Monday at nine.\r\n\r\n> Monday works for me.",
      -4,
      9,
    );
    // A reply whose References point at a message that is not in the mailbox.
    await m(ANA_FULL, "Broken thread", "b1", {}, "The original.", -3, 8);
    await m(
      RUI,
      "Re: Broken thread",
      "b2",
      { "In-Reply-To": mid("ghost"), References: mid("ghost") },
      "I answer a ghost.",
      -3,
      10,
    );
    // A "Re:" with no reference headers, and a later message that only shares the subject.
    await m(
      ANA_FULL,
      "Lunch plans",
      "c1",
      {},
      "Where shall we eat? I vote marmalade-cafe.",
      -9,
      10,
    );
    await m(RUI, "Re: Lunch plans", "c2", {}, "Fine with me.", -8, 10);
    await m(ANA_FULL, "Lunch plans", "c3", {}, "New week, new lunch.", -1, 10);
    // A "Re:" with no headers but 50 days after the original: too far.
    await m(ANA_FULL, "Old topic", "o1", {}, "Something from long ago.", -60, 10);
    await m(RUI, "Re: Old topic", "o2", {}, "Late answer.", -10, 10);
    // HTML with an inline image and a file attachment.
    const head = {
      from: ANA_FULL,
      to,
      subject: "Quarterly report",
      headers: { "Message-ID": mid("q1"), Date: at(-2) },
    };
    await deliver(g, {
      ...head,
      mime: withHeaders(
        head,
        'Content-Type: multipart/mixed; boundary="mix"',
        [
          "--mix",
          'Content-Type: multipart/related; boundary="rel"',
          "",
          "--rel",
          'Content-Type: multipart/alternative; boundary="alt"',
          "",
          "--alt",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Numbers are in the attachment.",
          "--alt",
          "Content-Type: text/html; charset=utf-8",
          "",
          '<p>Numbers are <b>in</b> the attachment.</p><img src="cid:chart@seed.example.invalid"><script>alert(1)</script>',
          "--alt--",
          "--rel",
          'Content-Type: image/png; name="chart.png"',
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: inline; filename="chart.png"',
          "Content-ID: <chart@seed.example.invalid>",
          "",
          wrap(PNG),
          "--rel--",
          "--mix",
          'Content-Type: application/pdf; name="report.pdf"',
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: attachment; filename="report.pdf"',
          "",
          wrap(PDF),
          "--mix--",
          "",
        ].join("\r\n"),
      ),
    });
    // One that cannot be read: bad base64, an unknown charset, no closing boundary, no Message-ID, an attachment with no name.
    const bad = { from: "Odd <odd@example.invalid>", to, subject: "Garbled" };
    await deliver(g, {
      ...bad,
      mime: withHeaders(
        bad,
        'Content-Type: multipart/mixed; boundary="zz"',
        [
          "--zz",
          "Content-Type: text/plain; charset=x-no-such-charset",
          "Content-Transfer-Encoding: base64",
          "",
          "@@@@ not base64 ####",
          "--zz",
          "Content-Type: application/octet-stream",
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: attachment; filename=""',
          "",
          "!!!",
        ].join("\r\n"),
      ),
    });
    // A file over the size limit (11 MB).
    const big = {
      from: ANA_FULL,
      to,
      subject: "Big file",
      headers: { "Message-ID": mid("big"), Date: at(0) },
    };
    await deliver(g, {
      ...big,
      mime: withHeaders(
        big,
        'Content-Type: multipart/mixed; boundary="bb"',
        [
          "--bb",
          "Content-Type: text/plain",
          "",
          "Here it is.",
          "--bb",
          'Content-Type: application/octet-stream; name="big.bin"',
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: attachment; filename="big.bin"',
          "",
          wrap(Buffer.alloc(11_000_000, 7)),
          "--bb--",
          "",
        ].join("\r\n"),
      ),
    });
  });

  afterAll(async () => {
    await closeImapPool();
    await g?.stop();
    configureMailPolicy({ allowPrivate: false });
  });

  test("check() signs in to both servers", async () => {
    await expect(bot.check()).resolves.toBeUndefined();
  });

  test("conversations come out grouped right, newest first", async () => {
    const list = await all();
    expect(list.map((c) => [c.subject, c.messageCount])).toEqual([
      ["Big file", 1],
      ["Garbled", 1],
      ["Quarterly report", 1],
      ["Old topic", 1], // the late "Re:" with no headers, too far from its original
      ["Old topic", 1],
      ["Lunch plans", 1], // the later message that only shares the subject
      ["Lunch plans", 2], // the "Re:" with no headers, joined to the first
      ["Broken thread", 1], // the reply that points at a ghost
      ["Broken thread", 1],
      ["Project kickoff", 3],
    ]);
    const kickoff = bySubject(list, "Project kickoff");
    expect(kickoff.participants.map((p) => p.address).sort()).toEqual(
      [BOT_ADDR, ANA_ADDR, "rui@example.invalid"].sort(),
    );
    expect(kickoff.participants.find((p) => p.address === ANA_ADDR)!.name).toBe("Ana Souza");
    // The snippet is the newest message's first words, without the quoted line.
    expect(kickoff.snippet).toBe("Great, Monday at nine.");
    expect(new Date(kickoff.lastDate).getTime()).toBeGreaterThan(NOW - 5 * DAY);
    expect(bySubject(list, "Quarterly report").snippet).toBe("Numbers are in the attachment.");
    // Files: only the conversations that have one (the image shown inside the text is not a file by itself).
    expect(
      list
        .filter((c) => c.attachments === "some")
        .map((c) => c.subject)
        .sort(),
    ).toEqual(["Big file", "Garbled", "Quarterly report"]);
    // Opaque ids are distinct.
    expect(new Set(list.map((c) => c.id)).size).toBe(10);
  });

  test("paging by cursor: three pages, no repeat, no gap, and the last page has no cursor", async () => {
    const full = await all();
    const seen: string[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const page = await bot.listConversations({ limit: 4, cursor });
      sizes.push(page.conversations.length);
      seen.push(...page.conversations.map((c) => c.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(sizes).toEqual([4, 4, 2]);
    expect(seen).toEqual(full.map((c) => c.id));
    // A cursor is for the same search; a made-up one is refused.
    const first = await bot.listConversations({ limit: 4 });
    await expect(
      bot.listConversations({ limit: 4, cursor: first.nextCursor, query: "kickoff" }),
    ).rejects.toMatchObject({ code: "BAD_ID" });
    await expect(bot.listConversations({ limit: 4, cursor: "nonsense" })).rejects.toMatchObject({
      code: "BAD_ID",
    });
  });

  test("search runs on the server, in the subject and in the body", async () => {
    const bySubjectWord = await all(bot, "kickoff");
    expect(bySubjectWord.map((c) => [c.subject, c.messageCount])).toEqual([["Project kickoff", 3]]);
    const byBodyWord = await all(bot, "marmalade-cafe");
    expect(byBodyWord.map((c) => c.subject)).toEqual(["Lunch plans"]);
    expect(await all(bot, "zzz-no-such-word")).toEqual([]);
    const page = await bot.listConversations({ limit: 5, query: "zzz-no-such-word" });
    expect(page.nextCursor).toBeUndefined();
  });

  test("opening a conversation gives every message in order, with its fields", async () => {
    const kickoff = bySubject(await all(), "Project kickoff");
    const c = await bot.getConversation(kickoff.id);
    expect(c.subject).toBe("Project kickoff");
    expect(c.messages.map((m) => m.messageId)).toEqual([
      "a1@seed.example.invalid",
      "a2@seed.example.invalid",
      "a3@seed.example.invalid",
    ]);
    const [a1, a2, a3] = c.messages;
    expect(a1).toMatchObject({
      origin: "received",
      subject: "Project kickoff",
      from: { name: "Ana Souza", address: ANA_ADDR },
      to: [{ address: BOT_ADDR }],
      source: "complete",
      htmlUnsafe: "",
    });
    expect(a1!.text.trim()).toBe("Let us start the kickoff on Monday.");
    expect(a2!.from!.address).toBe("rui@example.invalid");
    expect(a3!.text).toContain("> Monday works for me.");
    expect(a1!.date).toBe(new Date(at(-5, 10)).toISOString());
    expect(new Set(c.messages.map((m) => m.id)).size).toBe(3);
    await expect(bot.getConversation("nonsense")).rejects.toMatchObject({ code: "BAD_ID" });
  });

  test("the sent folder is looked at when a conversation opens: none yet, then the person's own reply", async () => {
    const kickoff = bySubject(await all(), "Project kickoff");
    expect((await bot.getConversation(kickoff.id)).messages).toHaveLength(3);
    // The person's mail program files its own replies in "Sent".
    const reply = [
      `From: ${BOT_ADDR}`,
      `To: ${RUI}`,
      "Subject: Re: Project kickoff",
      `Message-ID: ${mid("s1")}`,
      `In-Reply-To: ${mid("a2")}`,
      `References: ${mid("a1")} ${mid("a2")}`,
      `Date: ${at(-5, 12)}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Nine is fine, see you there.",
      "",
    ].join("\r\n");
    const unrelated = reply
      .replace("Subject: Re: Project kickoff", "Subject: Something else")
      .replace(mid("s1"), mid("s2"))
      .replace(`In-Reply-To: ${mid("a2")}\r\n`, "")
      .replace(`References: ${mid("a1")} ${mid("a2")}\r\n`, "");
    await asPerson(BOT, async (c) => {
      await c.mailboxCreate("Sent");
      await c.append("Sent", reply, ["\\Seen"]);
      await c.append("Sent", unrelated, ["\\Seen"]);
    });
    const opened = await bot.getConversation(kickoff.id);
    expect(opened.messages.map((m) => [m.messageId, m.origin])).toEqual([
      ["a1@seed.example.invalid", "received"],
      ["a2@seed.example.invalid", "received"],
      ["s1@seed.example.invalid", "sent"],
      ["a3@seed.example.invalid", "received"],
    ]);
    expect(opened.messages[2]!.text.trim()).toBe("Nine is fine, see you there.");
    // The list is the inbox only: the sent message is not a conversation of its own and does not change the count.
    const list = await all();
    expect(list).toHaveLength(10);
    expect(bySubject(list, "Project kickoff").messageCount).toBe(3);
  });

  test("an HTML message: raw html marked unsafe, the inline image described, the file downloadable, never the bytes in the description", async () => {
    const q = bySubject(await all(), "Quarterly report");
    const conv = await bot.getConversation(q.id);
    const [m] = conv.messages;
    expect(m!.text.trim()).toBe("Numbers are in the attachment.");
    expect(m!.htmlUnsafe).toContain("<script>alert(1)</script>");
    expect(m!.htmlUnsafe).toContain("cid:chart@seed.example.invalid");
    expect(m!.htmlUnsafe).not.toContain("data:image");
    expect(m!.attachments).toHaveLength(2);
    const inline = m!.attachments.find((a) => a.disposition === "inline")!;
    const file = m!.attachments.find((a) => a.disposition === "attachment")!;
    expect(inline).toMatchObject({
      fileName: "chart.png",
      contentType: "image/png",
      contentId: "chart@seed.example.invalid",
      size: PNG.length,
    });
    expect(file).toMatchObject({
      fileName: "report.pdf",
      contentType: "application/pdf",
      size: PDF.length,
    });
    expect(JSON.stringify(conv)).not.toContain(PDF.toString("base64").slice(0, 20));
    const got = await bot.getAttachment(conv.id, file.id);
    expect(Buffer.from(got.bytes).equals(PDF)).toBe(true);
    expect(got).toMatchObject({ fileName: "report.pdf", contentType: "application/pdf" });
    expect(Buffer.from((await bot.getAttachment(conv.id, inline.id)).bytes).equals(PNG)).toBe(true);
    await expect(bot.getAttachment(conv.id, `${file.id.split(".")[0]}.9`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(bot.getAttachment(conv.id, "nonsense")).rejects.toMatchObject({ code: "BAD_ID" });
  });

  test("getAttachments reads the files of a message together: a missing file is left out, a bad id is refused, a file over the cap is left out", async () => {
    const q = bySubject(await all(), "Quarterly report");
    const conv = await bot.getConversation(q.id);
    const files = conv.messages[0]!.attachments;
    const inline = files.find((a) => a.disposition === "inline")!;
    const file = files.find((a) => a.disposition === "attachment")!;
    const got = await bot.getAttachments(conv.id, [
      inline.id,
      file.id,
      `${file.id.split(".")[0]}.9`,
    ]);
    expect([...got.keys()].sort()).toEqual([file.id, inline.id].sort());
    expect(Buffer.from(got.get(file.id)!.bytes).equals(PDF)).toBe(true);
    expect(Buffer.from(got.get(inline.id)!.bytes).equals(PNG)).toBe(true);
    expect((await bot.getAttachments(conv.id, [])).size).toBe(0);
    await expect(bot.getAttachments(conv.id, ["nonsense"])).rejects.toMatchObject({
      code: "BAD_ID",
    });
    const big = await bot.getConversation(bySubject(await all(), "Big file").id);
    const bigFile = big.messages[0]!.attachments.find((a) => a.fileName === "big.bin")!;
    expect((await bot.getAttachments(big.id, [bigFile.id])).size).toBe(0);
  });

  test("a message that cannot be read does not break the list or opening it", async () => {
    const g1 = bySubject(await all(), "Garbled");
    const conv = await bot.getConversation(g1.id);
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]!.subject).toBe("Garbled");
    expect(["complete", "truncated", "unreadable"]).toContain(conv.messages[0]!.source);
    // The rest of the mailbox is still there.
    expect((await all()).length).toBe(10);
  });

  test("a message over the size limit is read only up to it, and its file is refused over the cap", async () => {
    const b = bySubject(await all(), "Big file");
    const conv = await bot.getConversation(b.id);
    expect(conv.messages[0]!.source).toBe("truncated");
    expect(conv.messages[0]!.text.trim()).toBe("Here it is.");
    const info = conv.messages[0]!.attachments.find((a) => a.fileName === "big.bin");
    expect(info).toBeDefined();
    await expect(bot.getAttachment(conv.id, info!.id)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  test("listing, opening and downloading change no message's flags (and the detector would see a change)", async () => {
    const before = await flagsOf(BOT);
    expect(Object.values(before).some((f) => f.includes("\\Seen"))).toBe(false);
    for (const q of [undefined, "kickoff"]) {
      for (const c of await all(bot, q)) {
        const conv: Conversation = await bot.getConversation(c.id);
        for (const m of conv.messages)
          for (const a of m.attachments)
            if (m.source === "complete") await bot.getAttachment(conv.id, a.id);
      }
    }
    expect(await flagsOf(BOT)).toEqual(before);

    // Control: a change made through a writable folder (what a mail program does) shows in the same snapshot, so "unchanged" above means something.
    const uid = Number(Object.keys(before)[0]);
    await asPerson(BOT, async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    });
    expect((await flagsOf(BOT))[uid]).toContain("\\Seen");
    await asPerson(BOT, async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        await c.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    });
    expect(await flagsOf(BOT)).toEqual(before);
  });

  test("one connection per mailbox, reused, never a pile, with commands that do not interleave", async () => {
    // What the answers must be, read once on its own connection; then a cold pool and twelve calls at the same moment.
    const expected = await all();
    const kickoff = bySubject(expected, "Project kickoff");
    await closeImapPool();
    const d = driverFor(BOT, { key: "pool-test" });
    const start = imapPoolStats().opened;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        i % 2
          ? d.listConversations({ limit: 50 }).then((p) => p.conversations.map((c) => c.id))
          : d.getConversation(kickoff.id).then((c) => c.messages.map((m) => m.messageId)),
      ),
    );
    results.forEach((r, i) =>
      expect(r).toEqual(
        i % 2
          ? expected.map((c) => c.id)
          : [
              "a1@seed.example.invalid",
              "a2@seed.example.invalid",
              "s1@seed.example.invalid",
              "a3@seed.example.invalid",
            ],
      ),
    );
    expect(imapPoolStats().opened - start).toBe(1);
    expect(imapPoolStats().open).toBe(1);
    await all(d);
    expect(imapPoolStats().opened - start).toBe(1);
    await closeImapPool();
    expect(imapPoolStats().open).toBe(0);
  });

  test("a connection is closed after its idle time", async () => {
    await closeImapPool();
    const d = driverFor(BOT, { key: "idle-test", idleMs: 400 });
    await all(d);
    expect(imapPoolStats().open).toBe(1);
    await Bun.sleep(1200);
    expect(imapPoolStats().open).toBe(0);
    // And the next call simply opens another.
    expect((await all(d)).length).toBe(10);
    await closeImapPool();
  });

  test("a wrong password is a safe AUTH error, and no connection is kept", async () => {
    const someId = bySubject(await all(), "Big file").id;
    await closeImapPool();
    const wrong = driverFor({ ...BOT, password: "not-the-password" }, { key: "wrong-test" });
    const e = await wrong.listConversations({ limit: 5 }).then(
      () => undefined,
      (x) => x,
    );
    expect(e).toMatchObject({ code: "AUTH" });
    for (const s of [e.message, e.safe, e.fix ?? ""]) {
      expect(s).not.toContain("not-the-password");
      expect(s).not.toContain(BOT.password);
    }
    await expect(wrong.check()).rejects.toMatchObject({ code: "AUTH" });
    await expect(wrong.getConversation(someId)).rejects.toMatchObject({ code: "AUTH" });
    expect(imapPoolStats().open).toBe(0);
  });

  test("an address the policy forbids is refused before any connection", async () => {
    configureMailPolicy({ allowPrivate: false });
    try {
      await expect(bot.check()).rejects.toMatchObject({ code: "BLOCKED_URL" });
    } finally {
      configureMailPolicy({ allowPrivate: true });
    }
  });

  test("send puts the right threading headers on a reply, set by the server from the message answered", async () => {
    const kickoff = bySubject(await all(), "Project kickoff");
    const conv = await bot.getConversation(kickoff.id);
    const a3 = conv.messages.find((m) => m.messageId === "a3@seed.example.invalid")!;
    const sent = await bot.send({
      to: [ANA_ADDR],
      subject: "Re: Project kickoff",
      text: "Monday at nine it is.\nSee you.",
      inReplyTo: a3.id,
    });
    expect(sent.messageId).toMatch(/@/);
    const fromAna = await readInbox(ANA, sent.messageId);
    expect(fromAna.inReplyTo).toBe(mid("a3"));
    expect(fromAna.references).toEqual([mid("a1"), mid("a2"), mid("a3")]);
    expect(fromAna.from).toBe(BOT_ADDR);
    expect(fromAna.text.trim()).toBe("Monday at nine it is.\nSee you.");
    expect(fromAna.contentType).toStartWith("text/plain");

    // Answering a message the person sent (found in the sent folder) works the same way.
    const s1 = conv.messages.find((m) => m.origin === "sent")!;
    const second = await bot.send({
      to: [ANA_ADDR],
      subject: "Re: Project kickoff",
      text: "One more thing.",
      inReplyTo: s1.id,
    });
    const again = await readInbox(ANA, second.messageId);
    expect(again.inReplyTo).toBe(mid("s1"));
    expect(again.references).toEqual([mid("a1"), mid("a2"), mid("s1")]);

    // A new message has no threading headers at all.
    const fresh = await bot.send({ to: [ANA_ADDR], subject: "Hello again", text: "A new topic." });
    const plain = await readInbox(ANA, fresh.messageId);
    expect(plain.inReplyTo).toBeUndefined();
    expect(plain.references).toEqual([]);
  });

  test("send refuses a header injection and nothing arrives", async () => {
    const before = Object.keys(await flagsOf(BEN)).length;
    await expect(
      bot.send({ to: [ANA_ADDR], subject: `x\r\nBcc: ${addressOf(BEN)}`, text: "no" }),
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(
      bot.send({ to: [`${ANA_ADDR}\r\nBcc: ${addressOf(BEN)}`], subject: "x", text: "no" }),
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
    await Bun.sleep(300);
    expect(Object.keys(await flagsOf(BEN)).length).toBe(before);
    // A rejected recipient from the server is a safe error too.
    await expect(
      bot.send({ to: [ANA_ADDR], subject: "x", text: "y", inReplyTo: "bad" }),
    ).rejects.toMatchObject({ code: "BAD_ID" });
  });

  test("paging stays stable when new mail arrives between pages", async () => {
    const ben = driverFor(BEN, { key: "ben-test" });
    for (let i = 1; i <= 5; i++)
      await deliver(g, {
        from: ANA_FULL,
        to: addressOf(BEN),
        subject: `N${i}`,
        headers: { "Message-ID": mid(`n${i}`), Date: at(-i) },
        body: `Message ${i}`,
      });
    const p1 = await ben.listConversations({ limit: 2 });
    expect(p1.conversations.map((c) => c.subject)).toEqual(["N5", "N4"]);
    await deliver(g, {
      from: ANA_FULL,
      to: addressOf(BEN),
      subject: "N6",
      headers: { "Message-ID": mid("n6") },
      body: "Brand new.",
    });
    const p2 = await ben.listConversations({ limit: 2, cursor: p1.nextCursor });
    expect(p2.conversations.map((c) => c.subject)).toEqual(["N3", "N2"]);
    const p3 = await ben.listConversations({ limit: 2, cursor: p2.nextCursor });
    expect(p3.conversations.map((c) => c.subject)).toEqual(["N1"]);
    expect(p3.nextCursor).toBeUndefined();
    // A fresh look starts with the new one.
    expect((await ben.listConversations({ limit: 2 })).conversations.map((c) => c.subject)).toEqual(
      ["N6", "N5"],
    );
    // A reply that arrives to an older conversation moves it to the top, and it is not shown twice.
    await deliver(g, {
      from: RUI,
      to: addressOf(BEN),
      subject: "Re: N1",
      headers: {
        "Message-ID": mid("n1r"),
        "In-Reply-To": mid("n1"),
        References: mid("n1"),
        Date: at(0),
      },
      body: "Late answer.",
    });
    const top = await ben.listConversations({ limit: 20 });
    expect(top.conversations.map((c) => c.subject)).toEqual(["N1", "N6", "N5", "N4", "N3", "N2"]);
    expect(top.conversations[0]!.messageCount).toBe(2);
  });

  /** The message with that Message-ID in a person's inbox, with the headers the tests read. */
  async function readInbox(u: TestUser, messageId: string) {
    const id = messageId.replace(/^<|>$/g, "");
    return asPerson(u, async (c) => {
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      try {
        const uids = await c.search({ header: { "message-id": id } }, { uid: true });
        expect(uids ? uids.length : 0).toBe(1);
        const m = await c.fetchOne(String((uids as number[])[0]), { source: true }, { uid: true });
        const p = await simpleParser(m ? (m.source as Buffer) : Buffer.alloc(0));
        return {
          inReplyTo: p.inReplyTo,
          references: ([] as string[]).concat(p.references ?? []),
          from: p.from?.value[0]?.address ?? "",
          text: p.text ?? "",
          contentType: String(
            p.headers.get("content-type") &&
              (p.headers.get("content-type") as { value: string }).value,
          ),
        };
      } finally {
        lock.release();
      }
    });
  }
});

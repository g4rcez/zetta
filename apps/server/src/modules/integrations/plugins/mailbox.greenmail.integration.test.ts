import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../../test-support/db-cleanup";
import { issueBackgroundActor } from "../../identity/access";
import { closeImapMailbox, closeImapPool } from "../../mail/drivers/imap";
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
import { configureMailPolicy } from "../../mail/imap-connect";
import { createMailHarness } from "../../mail/routes-harness";
import { createMailboxStore } from "../../mail/store";
import { configureMailbox } from "./mailbox";
import { createPlugins } from "./service";
import { actor } from "./test-world";

/**
 * The mailbox plugin's tools against a REAL GreenMail server in a local container, through the real IMAP driver and the real mail
 * service. Opt-in and needs a database:
 *
 *   ZETTA_TEST_DB=embedded ZETTA_TEST_GREENMAIL=1 ZETTA_DOCKER_BIN=/opt/podman/bin/podman bun --no-env-file test src/modules/integrations/plugins/mailbox.greenmail.integration.test.ts
 */
setDefaultTimeout(120_000);
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = GREENMAIL_ENABLED && url ? describe : describe.skip;
const ANA: TestUser = { login: "ana", password: "ana-pass-test" };
const A = `mbx-g-${uuidv7()}`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const wrap = (b: Buffer) => b.toString("base64").replace(/.{76}/g, "$&\r\n");
const NOTICE = "UNTRUSTED EXTERNAL CONTENT";

suite("the mailbox plugin against a real GreenMail server", () => {
  let g: Greenmail;
  let ownerBot = "";
  let box = "";
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const h = createMailHarness(db, { closeConnection: closeImapMailbox });
  const lookup = async () => ({ isAdmin: false });
  const plugins = createPlugins(
    db,
    {} as never,
    () => ({ bound: async () => [] }) as never,
    async () => false,
  );
  const run = (tool: string, args: Record<string, unknown>) =>
    plugins.callTool(actor(A), ownerBot, "mailbox", tool, args, undefined, "chat");

  beforeAll(async () => {
    configureMailPolicy({ allowPrivate: true });
    const now = new Date();
    await db.insert(user).values({
      id: A,
      name: A,
      email: `${A}@example.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active" as const, joinedAt: now, updatedAt: now });
    ownerBot = (
      await db
        .insert(bot)
        .values({
          ownerUserId: A,
          name: "Mailer",
          slug: `mailer-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
          onboarded: true,
        })
        .returning({ id: bot.id })
    )[0]!.id;
    g = await startGreenmail([ANA]);
    const me = addressOf(ANA);
    // A conversation of two messages: a question, and a reply that points at it.
    await deliver(g, {
      from: "Rui <rui@example.invalid>",
      to: me,
      subject: "Planning",
      headers: { "Message-ID": "<p1@seed.example.invalid>" },
      body: "Can we move the planning to Thursday?",
    });
    await deliver(g, {
      from: "Bia <bia@example.invalid>",
      to: me,
      subject: "Re: Planning",
      headers: {
        "Message-ID": "<p2@seed.example.invalid>",
        "In-Reply-To": "<p1@seed.example.invalid>",
        References: "<p1@seed.example.invalid>",
      },
      body: "Thursday works for me too.",
    });
    // A message with an attachment and an inline picture.
    const head = {
      from: "Rui <rui@example.invalid>",
      to: me,
      subject: "Quarterly report",
      headers: { "Message-ID": "<q1@seed.example.invalid>" },
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
          '<p>Numbers are <b>in</b> the attachment.</p><img src="cid:chart@seed.example.invalid">',
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
    const a = (await issueBackgroundActor(lookup, A))!;
    box = (
      await h.mail.connect(a, {
        address: me,
        label: "Ana",
        servers: {
          imapHost: "127.0.0.1",
          imapPort: g.imapPort,
          imapSecurity: "starttls",
          smtpHost: "127.0.0.1",
          smtpPort: g.smtpPort,
          smtpSecurity: "starttls",
          user: loginOf(ANA),
        },
        password: ANA.password,
        botId: ownerBot,
      })
    ).id;
    configureMailbox({
      sealKey: (userId) => `test-seal-key-${userId}`,
      store: createMailboxStore(db),
      mail: h.mail,
      actorFor: (userId) => issueBackgroundActor(lookup, userId),
      async botOf(userId, botId) {
        const [row] = await db
          .select({ id: bot.id, kind: bot.kind, ownerUserId: bot.ownerUserId })
          .from(bot)
          .where(and(eq(bot.id, botId), eq(bot.ownerUserId, userId)));
        return row ?? null;
      },
    });
  });
  afterAll(async () => {
    configureMailbox(undefined);
    await closeImapPool();
    await g?.stop();
    configureMailPolicy({ allowPrivate: false });
    await cleanupTestUsers(db, [A]);
  });

  test("mailbox_list shows the mailbox and nothing of its servers", async () => {
    const out = await run("mailbox_list", {});
    expect(JSON.parse(out).mailboxes).toEqual([
      { id: box, address: addressOf(ANA), label: "Ana", state: "active" },
    ]);
    expect(out).not.toContain("127.0.0.1");
    expect(out).not.toContain(ANA.password);
  });

  test("mail_conversations lists the threaded conversation once, newest first, without the mailbox's own address among the people", async () => {
    const out = await run("mail_conversations", { mailbox: box });
    const j = JSON.parse(out);
    expect(j.notice).toContain(NOTICE);
    expect(j.conversations.map((c: { subject: string }) => c.subject)).toEqual([
      "Quarterly report",
      "Planning",
    ]);
    const planning = j.conversations.find((c: { subject: string }) => c.subject === "Planning");
    expect(planning.messageCount).toBe(2);
    expect(planning.participants).toContain("Bia <bia@example.invalid>");
    expect(planning.participants).toContain("Rui <rui@example.invalid>");
    expect(planning.participants).not.toContain(addressOf(ANA));
    expect(j.conversations[0].attachments).toBe("some");
    const found = JSON.parse(await run("mail_conversations", { mailbox: box, query: "Quarterly" }));
    expect(found.conversations.map((c: { subject: string }) => c.subject)).toEqual([
      "Quarterly report",
    ]);
  });

  test("mail_read gives the whole thread as plain text", async () => {
    const list = JSON.parse(await run("mail_conversations", { mailbox: box }));
    const planning = list.conversations.find((c: { subject: string }) => c.subject === "Planning");
    const out = await run("mail_read", { mailbox: box, conversation: planning.id });
    expect(out).toContain(NOTICE);
    expect(out).toContain("message 1 of 2");
    expect(out).toContain("Can we move the planning to Thursday?");
    expect(out).toContain("Thursday works for me too.");
    expect(out).toContain("From: Bia <bia@example.invalid>");
    expect(out).toContain(`To: ${addressOf(ANA)}`);
    expect(out.indexOf("planning to Thursday")).toBeLessThan(out.indexOf("Thursday works"));
  });

  test("mail_read names the attachment, never opens it, and shows no HTML or picture bytes", async () => {
    const list = JSON.parse(await run("mail_conversations", { mailbox: box, query: "Quarterly" }));
    const out = await run("mail_read", { mailbox: box, conversation: list.conversations[0].id });
    expect(out).toContain("Numbers are in the attachment.");
    expect(out).toMatch(/Files \(not opened\): report\.pdf \(application\/pdf, \d+ B\)/);
    expect(out).not.toContain("chart.png");
    expect(out).not.toMatch(/<\/?(p|b|img|html)\b|data:image|%PDF/i);
  });

  test("a conversation id that is not one of this mailbox's is answered with a safe sentence", async () => {
    await expect(
      run("mail_read", { mailbox: box, conversation: "not-a-conversation" }),
    ).rejects.toMatchObject({ code: "BAD_ID" });
  });
});

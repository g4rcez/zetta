import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { closeImapMailbox, closeImapPool, imapPoolStats } from "./drivers/imap";
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
import { createMailHarness } from "./routes-harness";

/**
 * The mailbox routes against a REAL GreenMail server in a local container, with the real IMAP driver. Opt-in and needs a database:
 *
 *   ZETTA_TEST_DB=embedded ZETTA_TEST_GREENMAIL=1 ZETTA_DOCKER_BIN=/opt/podman/bin/podman bun --no-env-file test src/modules/mail/routes.greenmail.integration.test.ts
 */
setDefaultTimeout(120_000);
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = GREENMAIL_ENABLED && url ? describe : describe.skip;
const ANA: TestUser = { login: "ana", password: "ana-pass-test" };
const A = `mbg-a-${uuidv7()}`;
const B = `mbg-b-${uuidv7()}`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const wrap = (b: Buffer) => b.toString("base64").replace(/.{76}/g, "$&\r\n");

suite("the mailbox routes against a real GreenMail server", () => {
  let g: Greenmail;
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const h = createMailHarness(db, { closeConnection: closeImapMailbox });
  const body = (password: string) => ({
    address: addressOf(ANA),
    label: "Ana",
    imapHost: "127.0.0.1",
    imapPort: g.imapPort,
    imapSecurity: "starttls",
    smtpHost: "127.0.0.1",
    smtpPort: g.smtpPort,
    smtpSecurity: "starttls",
    user: loginOf(ANA),
    sealed: { password },
  });

  beforeAll(async () => {
    configureMailPolicy({ allowPrivate: true });
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
    g = await startGreenmail([ANA]);
    const head = {
      from: "Rui <rui@example.invalid>",
      to: addressOf(ANA),
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
          '<p>Numbers are <b>in</b> the attachment.</p><img src="cid:chart@seed.example.invalid"><img src="https://track.example.invalid/p.gif"><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
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
  });
  afterAll(async () => {
    await closeImapPool();
    await g?.stop();
    configureMailPolicy({ allowPrivate: false });
    await cleanupTestUsers(db, [A, B]);
  });

  test("a wrong password is refused with the safe sentence and nothing is saved", async () => {
    const r = await h.call(A, "POST", "/api/mailboxes", body("wrong-password"));
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("AUTH");
    expect(r.json.error.message).toBe("The mail server did not accept the user name and password.");
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    expect(h.secrets.size).toBe(0);
  });

  test("connect, list, open a conversation with HTML, download an attachment, remove", async () => {
    const made = await h.call(A, "POST", "/api/mailboxes", body(ANA.password));
    expect(made.status).toBe(201);
    expect(made.text).not.toContain(ANA.password);
    const id = made.json.mailbox.id as string;
    expect(made.json.mailbox.state).toBe("active");

    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toHaveLength(1);
    expect((await h.call(B, "GET", `/api/mailboxes/${id}/conversations`)).status).toBe(404);

    const list = await h.call(A, "GET", `/api/mailboxes/${id}/conversations`);
    expect(list.status).toBe(200);
    expect(list.json.conversations).toHaveLength(1);
    const found = await h.call(A, "GET", `/api/mailboxes/${id}/conversations?q=Quarterly`);
    expect(found.json.conversations).toHaveLength(1);
    expect(list.json.conversations[0]).toMatchObject({
      subject: "Quarterly report",
      messageCount: 1,
      attachments: "some",
    });
    const cid = list.json.conversations[0].id as string;

    const open = await h.call(
      A,
      "GET",
      `/api/mailboxes/${id}/conversations/${encodeURIComponent(cid)}`,
    );
    expect(open.status).toBe(200);
    expect(open.text).not.toContain("htmlUnsafe");
    const msg = open.json.conversation.messages[0];
    expect(msg.html).toContain("<b>in</b>");
    expect(msg.html).not.toMatch(/script|alert|javascript|track\.example/i);
    expect(msg.html).toContain("data:image/png;base64,");
    expect(msg.remoteImages).toBe("removed");

    const pdf = msg.attachments.find((a: any) => a.fileName === "report.pdf");
    expect(pdf.disposition).toBe("attachment");
    const dl = await h.call(
      A,
      "GET",
      `/api/mailboxes/${id}/conversations/${encodeURIComponent(cid)}/attachments/${encodeURIComponent(pdf.id)}`,
    );
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect(dl.headers.get("content-disposition")).toContain('filename="report.pdf"');
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(dl.bytes).equals(PDF)).toBe(true);

    expect(imapPoolStats().open).toBeGreaterThan(0);
    const secret = [...h.secrets.keys()][0]!;
    const gone = await h.call(A, "DELETE", `/api/mailboxes/${id}`);
    expect(gone.status).toBe(200);
    expect(h.revoked).toEqual([secret]);
    expect(imapPoolStats().open).toBe(0);
    expect((await h.call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    expect((await h.call(A, "GET", `/api/mailboxes/${id}/conversations`)).status).toBe(404);
  });

  test("a wrong new password on an existing mailbox is refused and the old one keeps working", async () => {
    const id = (await h.call(A, "POST", "/api/mailboxes", body(ANA.password))).json.mailbox
      .id as string;
    const bad = await h.call(A, "PATCH", `/api/mailboxes/${id}`, { sealed: { password: "nope" } });
    expect(bad.status).toBe(422);
    expect((await h.call(A, "GET", `/api/mailboxes/${id}/conversations`)).status).toBe(200);
    await h.call(A, "DELETE", `/api/mailboxes/${id}`);
  });

  test("a server that stops answering marks the mailbox, and coming back clears it", async () => {
    const id = (await h.call(A, "POST", "/api/mailboxes", body(ANA.password))).json.mailbox
      .id as string;
    await g.stop();
    await closeImapPool();
    const down = await h.call(A, "GET", `/api/mailboxes/${id}/conversations`);
    expect([502]).toContain(down.status);
    const row = (await h.call(A, "GET", "/api/mailboxes")).json.mailboxes[0];
    expect(row.state).toBe("error");
    expect(row.lastError).toMatch(/^The mail server could not be reached to /);
  });
});

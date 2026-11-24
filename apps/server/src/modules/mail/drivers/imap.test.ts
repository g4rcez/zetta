import { describe, expect, test } from "bun:test";
import {
  checkOutgoing,
  createImapDriver,
  decodeConversation,
  decodeCursor,
  decodeMessage,
  encodeToken,
  findSentFolder,
  hasFileAttachment,
  imapPoolStats,
  snippetOf,
  textParts,
  uidSet,
} from "./imap";
import { configureMailPolicy } from "../imap-connect";

const server = {
  imapHost: "127.0.0.1",
  imapPort: 1,
  smtpHost: "127.0.0.1",
  smtpPort: 1,
  user: "bot",
  password: "fake-password-test",
};
const own = "bot@example.invalid";
const mail = { to: ["ana@example.invalid"], subject: "Hello", text: "Hi" };
const refuses = (m: Parameters<typeof checkOutgoing>[0]) => {
  try {
    checkOutgoing(m, own);
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("uidSet", () => {
  test("ranges, singles, order and duplicates", () => {
    expect(uidSet([7, 1, 2, 3, 3, 9, 8])).toBe("1:3,7:9");
    expect(uidSet([5])).toBe("5");
    expect(uidSet([])).toBe("");
  });
});

describe("tokens", () => {
  test("round trip", () => {
    expect(decodeConversation(encodeToken({ v: 1, k: "c", vl: "7", u: [1, 2] })).u).toEqual([1, 2]);
    expect(decodeCursor(encodeToken({ v: 1, k: "p", vl: "7", b: 5, q: "" })).b).toBe(5);
    expect(
      decodeMessage(encodeToken({ v: 1, k: "m", vl: "7", o: "sent", f: "Sent", u: 3 })).f,
    ).toBe("Sent");
  });
  test("anything else is refused with a stable code", () => {
    for (const bad of ["", "not base64 json", encodeToken({ v: 1, k: "p", vl: "1", b: 1, q: "" })])
      expect(() => decodeConversation(bad)).toThrow(expect.objectContaining({ code: "BAD_ID" }));
    expect(() => decodeMessage(encodeToken({ v: 1, k: "c", vl: "1", u: [1] }))).toThrow();
    expect(() => decodeConversation(encodeToken({ v: 1, k: "c", vl: "1", u: [-1] }))).toThrow();
    expect(() =>
      decodeConversation(
        encodeToken({ v: 1, k: "c", vl: "1", u: Array.from({ length: 500 }, (_, i) => i + 1) }),
      ),
    ).toThrow();
  });
});

describe("findSentFolder", () => {
  test("the folder the server marks \\Sent wins over a name", () => {
    expect(
      findSentFolder([
        { path: "INBOX" },
        { path: "Sent" },
        { path: "Enviadas-do-Rui", specialUse: "\\Sent" },
      ]),
    ).toBe("Enviadas-do-Rui");
  });
  test("common names, also under INBOX., any case", () => {
    expect(findSentFolder([{ path: "INBOX" }, { path: "Sent Items" }])).toBe("Sent Items");
    expect(findSentFolder([{ path: "INBOX" }, { path: "INBOX.Sent", delimiter: "." }])).toBe(
      "INBOX.Sent",
    );
    expect(findSentFolder([{ path: "[Gmail]/Sent Mail" }])).toBe("[Gmail]/Sent Mail");
    expect(findSentFolder([{ path: "Itens Enviados" }])).toBe("Itens Enviados");
  });
  test("none, and a non-selectable folder, give undefined", () => {
    expect(findSentFolder([{ path: "INBOX" }, { path: "Drafts" }])).toBeUndefined();
    expect(findSentFolder([{ path: "Sent", flags: ["\\Noselect"] }])).toBeUndefined();
  });
});

describe("snippetOf", () => {
  test("drops quoted lines, tags and extra space", () => {
    expect(snippetOf("Thanks!\n> old text\n\n  See you   Friday\n")).toBe("Thanks! See you Friday");
    expect(snippetOf("<p>Hi <b>there</b></p><style>p{}</style>")).toBe("Hi there");
    expect(snippetOf("x".repeat(500)).length).toBe(160);
  });
});

describe("body structure", () => {
  const plain = { type: "text/plain", part: "1.1", parameters: { charset: "utf-8" } };
  const html = { type: "text/html", part: "1.2" };
  const tree = {
    type: "multipart/mixed",
    childNodes: [
      { type: "multipart/alternative", part: "1", childNodes: [html, plain] },
      {
        type: "application/pdf",
        part: "2",
        disposition: "attachment",
        dispositionParameters: { filename: "a.pdf" },
      },
    ],
  };
  test("plain text is chosen before html, attachments are not text", () => {
    expect(textParts(tree as never).map((p) => p.part)).toEqual(["1.1", "1.2"]);
  });
  test("a file is an attachment, an inline image is not", () => {
    expect(hasFileAttachment(tree as never)).toBe(true);
    expect(
      hasFileAttachment({
        type: "multipart/related",
        childNodes: [
          plain,
          { type: "image/png", disposition: "inline", id: "<c>", parameters: { name: "l.png" } },
        ],
      } as never),
    ).toBe(false);
    expect(hasFileAttachment(plain as never)).toBe(false);
  });
});

describe("send refuses anything that could inject a header", () => {
  test("the plain case passes", () => expect(refuses(mail)).toBeUndefined());
  test.each([
    ["line break in the subject", { ...mail, subject: "Hi\r\nBcc: evil@example.invalid" }],
    ["lone LF in the subject", { ...mail, subject: "Hi\nBcc: evil@example.invalid" }],
    ["lone CR in the subject", { ...mail, subject: "Hi\rBcc: evil@example.invalid" }],
    ["unicode line separator", { ...mail, subject: "Hi Bcc: x" }],
    ["NUL in the subject", { ...mail, subject: "Hi\u0000" }],
    [
      "line break in an address",
      { ...mail, to: ["ana@example.invalid\r\nBcc: evil@example.invalid"] },
    ],
    ["two addresses in one", { ...mail, to: ["a@example.invalid, b@example.invalid"] }],
    ["a display name", { ...mail, to: ["Ana <ana@example.invalid>"] }],
    ["no recipient", { ...mail, to: [] }],
    [
      "too many recipients",
      { ...mail, to: Array.from({ length: 21 }, (_, i) => `a${i}@example.invalid`) },
    ],
    ["a very long subject", { ...mail, subject: "x".repeat(999) }],
  ])("%s", (_n, m) => expect(refuses(m as never)).toBe("BAD_INPUT"));

  test("the driver refuses before it connects anywhere", async () => {
    const d = createImapDriver({ key: "unit", address: own, server });
    await expect(d.send({ ...mail, subject: "a\r\nBcc: x@example.invalid" })).rejects.toMatchObject(
      { code: "BAD_INPUT" },
    );
  });

  test("a garbage id of the message to answer is refused", async () => {
    const d = createImapDriver({ key: "unit", address: own, server });
    await expect(d.send({ ...mail, inReplyTo: "not-an-id" })).rejects.toMatchObject({
      code: "BAD_ID",
    });
  });
});

describe("a server that never answers", () => {
  test("the call gives up after the operation time with a safe TIMEOUT error and keeps no connection", async () => {
    configureMailPolicy({ allowPrivate: true });
    // Accepts the connection and says nothing.
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } });
    try {
      const d = createImapDriver({
        key: "silent",
        address: own,
        operationMs: 400,
        server: { ...server, imapPort: silent.port, smtpPort: silent.port },
      });
      const started = Date.now();
      const e = await d.listConversations({ limit: 5 }).then(
        () => undefined,
        (x) => x,
      );
      expect(e).toMatchObject({ code: "TIMEOUT" });
      expect(Date.now() - started).toBeLessThan(3000);
      expect(imapPoolStats().open).toBe(0);
    } finally {
      silent.stop(true);
      configureMailPolicy({ allowPrivate: false });
    }
  });
});

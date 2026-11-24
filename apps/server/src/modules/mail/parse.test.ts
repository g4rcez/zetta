import { describe, expect, test } from "bun:test";
import { parseMessage, parseThreadHeaders, extractAttachment } from "./parse";

const enc = (s: string) => new TextEncoder().encode(s.replace(/\n/g, "\r\n"));
const o = { id: "ref1", origin: "received", truncated: false } as const;

const multipart = `From: Ana Souza <Ana@Example.invalid>
To: bot@example.invalid, "Rui" <rui@example.invalid>
Cc: team@example.invalid
Subject: =?UTF-8?Q?Relat=C3=B3rio_pronto?=
Date: Tue, 03 Nov 2026 10:00:00 +0000
Message-ID: <m1@example.invalid>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="mix"

--mix
Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset=utf-8

Hello plain
--alt
Content-Type: text/html; charset=utf-8

<p>Hello <b>html</b></p><img src="cid:logo@example.invalid"><script>alert(1)</script>
--alt--
--rel
Content-Type: image/png; name="logo.png"
Content-Transfer-Encoding: base64
Content-Disposition: inline; filename="logo.png"
Content-ID: <logo@example.invalid>

iVBORw0KGgo=
--rel--
--mix
Content-Type: application/pdf; name="../../etc/report.pdf"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="../../etc/report.pdf"

JVBERi0xLjQK
--mix--
`;

describe("parseMessage", () => {
  test("headers, text, raw html and attachments", async () => {
    const m = await parseMessage(enc(multipart), o);
    expect(m.id).toBe("ref1");
    expect(m.messageId).toBe("m1@example.invalid");
    expect(m.from).toEqual({ name: "Ana Souza", address: "ana@example.invalid" });
    expect(m.to.map((a) => a.address)).toEqual(["bot@example.invalid", "rui@example.invalid"]);
    expect(m.cc.map((a) => a.address)).toEqual(["team@example.invalid"]);
    expect(m.subject).toBe("Relatório pronto");
    expect(m.date).toBe("2026-11-03T10:00:00.000Z");
    expect(m.text.trim()).toBe("Hello plain");
    expect(m.source).toBe("complete");
  });

  test("the html is raw (unsafe) and the cid image is described, not inlined", async () => {
    const m = await parseMessage(enc(multipart), o);
    expect(m.htmlUnsafe).toContain("<script>alert(1)</script>");
    expect(m.htmlUnsafe).toContain("cid:logo@example.invalid");
    expect(m.htmlUnsafe).not.toContain("data:image");
    const inline = m.attachments.find((a) => a.disposition === "inline")!;
    expect(inline).toMatchObject({
      fileName: "logo.png",
      contentType: "image/png",
      contentId: "logo@example.invalid",
    });
    const file = m.attachments.find((a) => a.disposition === "attachment")!;
    expect(file.contentType).toBe("application/pdf");
    // A path in the name cannot climb out of anything.
    expect(file.fileName).not.toContain("/");
    expect(file.size).toBeGreaterThan(0);
    // Never the bytes.
    expect(JSON.stringify(m)).not.toContain("JVBERi0x");
  });

  test("attachment ids are opaque, distinct and carry the message id", async () => {
    const m = await parseMessage(enc(multipart), o);
    expect(new Set(m.attachments.map((a) => a.id)).size).toBe(2);
    expect(m.attachments.every((a) => a.id.startsWith("ref1."))).toBe(true);
  });

  test("extractAttachment returns the decoded bytes by index", async () => {
    const m = await parseMessage(enc(multipart), o);
    const i = m.attachments.findIndex((a) => a.disposition === "attachment");
    const f = await extractAttachment(enc(multipart), i);
    expect(new TextDecoder().decode(f!.bytes)).toBe("%PDF-1.4\n");
    expect(await extractAttachment(enc(multipart), 9)).toBeUndefined();
  });

  test("a plain text message has no html and no attachments", async () => {
    const m = await parseMessage(enc("From: a@example.invalid\nSubject: Hi\n\nJust text\n"), o);
    expect(m.text.trim()).toBe("Just text");
    expect(m.htmlUnsafe).toBe("");
    expect(m.attachments).toEqual([]);
  });

  test("an html-only message still gets readable text", async () => {
    const m = await parseMessage(
      enc(
        "From: a@example.invalid\nSubject: Hi\nContent-Type: text/html\n\n<p>Only <i>html</i></p>\n",
      ),
      o,
    );
    expect(m.text).toContain("Only");
    expect(m.htmlUnsafe).toContain("<i>html</i>");
  });

  test("a message with no date or addresses is still described", async () => {
    const m = await parseMessage(enc("Subject: x\n\nbody\n"), o);
    expect(m.date).toBeNull();
    expect(m.from).toBeNull();
    expect(m.to).toEqual([]);
  });

  test("garbage and a broken structure never throw", async () => {
    const garbage = await parseMessage(new Uint8Array([0, 255, 254, 1, 2, 3]), o);
    expect(["complete", "unreadable"]).toContain(garbage.source);
    const broken = await parseMessage(
      enc(
        "From: a@example.invalid\nSubject: Odd\nContent-Type: multipart/mixed\nContent-Transfer-Encoding: base64\n\n@@@@not base64@@@@\n",
      ),
      o,
    );
    expect(broken.subject).toBe("Odd");
  });

  test("a truncated source is marked, and the text is cut at the limit", async () => {
    const m = await parseMessage(
      enc("From: a@example.invalid\nSubject: Big\n\n" + "x".repeat(150_000) + "\n"),
      {
        ...o,
        truncated: true,
      },
    );
    expect(m.source).toBe("truncated");
    expect(m.text.length).toBe(100_000);
  });

  test("control characters in a subject become spaces", async () => {
    const m = await parseMessage(enc("Subject: a\u0001b\u0007c\n\nx\n"), o);
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f]/.test(m.subject)).toBe(false);
  });
});

describe("parseThreadHeaders", () => {
  test("reads the three headers, unfolding long References", () => {
    const h = parseThreadHeaders(
      "Message-ID: <C@x.invalid>\r\nIn-Reply-To: <b@x.invalid>\r\nReferences: <a@x.invalid>\r\n <b@x.invalid>\r\n\r\n",
    );
    expect(h).toEqual({
      messageId: "c@x.invalid",
      inReplyTo: ["b@x.invalid"],
      references: ["a@x.invalid", "b@x.invalid"],
    });
  });
  test("missing headers are empty", () => {
    expect(parseThreadHeaders(undefined)).toEqual({ messageId: "", inReplyTo: [], references: [] });
    expect(parseThreadHeaders("X-Original-Message-ID: <no@x.invalid>\r\n")).toEqual({
      messageId: "",
      inReplyTo: [],
      references: [],
    });
  });
});

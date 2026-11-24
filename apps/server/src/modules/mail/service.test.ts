import { describe, expect, test } from "bun:test";
import type {
  AttachmentBytes,
  AttachmentInfo,
  Conversation,
  MailAddress,
  MailboxDriver,
  MailMessage,
} from "./driver";
import { createMailService, othersOf, type MailSecrets } from "./service";
import type { Mailbox, MailboxStore } from "./store";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ME = "ana@example.invalid";
const a = (name: string, address: string): MailAddress => ({ name, address });

describe("the other people of a conversation", () => {
  const rui = a("Rui", "rui@example.invalid");
  const me = a("Ana", ME);
  const table: [string, MailAddress[], MailAddress[]][] = [
    ["the mailbox's own address is left out", [rui, me], [rui]],
    ["whatever the case of the address", [a("", "ANA@Example.Invalid"), rui], [rui]],
    ["mail the person sent to themselves keeps it, as the only one", [me], [me]],
    [
      "several people, the mailbox among them",
      [me, rui, a("", "bia@example.invalid")],
      [rui, a("", "bia@example.invalid")],
    ],
    ["no one", [], []],
  ];
  for (const [name, input, want] of table)
    test(name, () => expect(othersOf(input, ME)).toEqual(want));
});

const row = (): Mailbox =>
  ({
    id: "box-1",
    ownerUserId: "u1",
    kind: "imap",
    address: ME,
    label: "",
    botId: null,
    connectionId: "conn-1",
    config: {
      imapHost: "imap.example.invalid",
      imapPort: 993,
      smtpHost: "smtp.example.invalid",
      smtpPort: 465,
      user: ME,
    },
    state: "active",
    lastError: null,
    sending: "off",
    allowedSenders: [],
  }) as unknown as Mailbox;

const file = (over: Partial<AttachmentInfo>): AttachmentInfo => ({
  id: "m.0",
  fileName: "f",
  contentType: "image/png",
  size: PNG.length,
  disposition: "inline",
  contentId: "",
  ...over,
});
const message = (id: string, over: Partial<MailMessage> = {}): MailMessage => ({
  id,
  messageId: `${id}@example.invalid`,
  origin: "received",
  from: a("Rui", "rui@example.invalid"),
  to: [a("Ana", ME)],
  cc: [],
  replyTo: [],
  date: "2026-01-01T10:00:00.000Z",
  subject: "Photos",
  text: "",
  htmlUnsafe: "",
  attachments: [],
  source: "complete",
  ...over,
});

function setup(conversation: Conversation, listed: MailAddress[][] = []) {
  const log = { single: [] as string[], batch: [] as string[][], limits: [] as number[] };
  const driver: MailboxDriver = {
    check: async () => {},
    listConversations: async (q) => {
      log.limits.push(q.limit);
      return {
        conversations: listed.map((participants, i) => ({
          id: `c${i}`,
          subject: "s",
          participants,
          lastDate: "2026-01-01T00:00:00.000Z",
          messageCount: 1,
          snippet: "",
          attachments: "none" as const,
        })),
      };
    },
    getConversation: async () => conversation,
    getAttachment: async (_c, id) => {
      log.single.push(id);
      return { fileName: "x", contentType: "image/png", bytes: new Uint8Array(PNG) };
    },
    getAttachments: async (_c, ids) => {
      log.batch.push(ids);
      return new Map<string, AttachmentBytes>(
        ids.map((id) => [
          id,
          { fileName: "x", contentType: "image/png", bytes: new Uint8Array(PNG) },
        ]),
      );
    },
    send: async () => ({ messageId: "x", copy: "provider" }),
  };
  const store = {
    get: async () => row(),
    update: async () => row(),
    list: async () => [row()],
  } as unknown as MailboxStore;
  const secrets: MailSecrets = {
    create: async () => ({ id: "c" }),
    list: async () => [],
    revoke: async () => {},
    secretFor: async () => Buffer.from("pw-test-not-a-real-password"),
  };
  const service = createMailService({
    store,
    secrets,
    driverFor: () => driver,
    closeConnection: async () => {},
  });
  const actor = { userId: "u1", isAdmin: false } as never;
  return { service, actor, log };
}

describe("the conversation list", () => {
  test("leaves the mailbox's own address out of the participants, for any driver", async () => {
    const rui = a("Rui", "rui@example.invalid");
    const { service, actor } = setup({ id: "c", subject: "", messages: [] }, [
      [rui, a("Ana", ME)],
      [a("", ME)],
    ]);
    const page = await service.conversations(actor, "box-1", {});
    expect(page.conversations.map((c) => c.participants)).toEqual([[rui], [a("", ME)]]);
  });

  test("a page is at most 30, and a smaller limit is passed to the driver", async () => {
    const { service, actor, log } = setup({ id: "c", subject: "", messages: [] });
    await service.conversations(actor, "box-1", {});
    await service.conversations(actor, "box-1", { limit: 20 });
    await service.conversations(actor, "box-1", { limit: 500 });
    await service.conversations(actor, "box-1", { limit: 0 });
    expect(log.limits).toEqual([30, 20, 30, 30]);
  });
});

describe("a conversation with inline images", () => {
  const html = (n: number) =>
    Array.from({ length: n }, (_, i) => `<img src="cid:img${i}@x">`).join("");
  const inline = (n: number, msgId: string) =>
    Array.from({ length: n }, (_, i) =>
      file({ id: `${msgId}.${i}`, contentId: `<img${i}@x>`, fileName: `i${i}.png` }),
    );

  test("the source of a message is read once for all its images, not once per image", async () => {
    const { service, actor, log } = setup({
      id: "c",
      subject: "Photos",
      messages: [
        message("m1", { htmlUnsafe: html(4), attachments: inline(4, "m1") }),
        message("m2", { htmlUnsafe: html(2), attachments: inline(2, "m2") }),
      ],
    });
    const c = await service.conversation(actor, "box-1", "c", "blocked");
    expect(log.single).toEqual([]);
    expect(log.batch).toEqual([
      ["m1.0", "m1.1", "m1.2", "m1.3"],
      ["m2.0", "m2.1"],
    ]);
    expect(c.messages[0]!.html.match(/src="data:image\/png/g)?.length).toBe(4);
    expect(c.messages[1]!.html.match(/src="data:image\/png/g)?.length).toBe(2);
  });

  test("an image over the size limit, one the HTML does not use and a repeated cid are not read", async () => {
    const { service, actor, log } = setup({
      id: "c",
      subject: "Photos",
      messages: [
        message("m1", {
          htmlUnsafe: `${html(1)}<img src="cid:img0@x">`,
          attachments: [
            file({ id: "m1.0", contentId: "<img0@x>" }),
            file({ id: "m1.1", contentId: "<img0@x>" }),
            file({ id: "m1.2", contentId: "<unused@x>" }),
            file({ id: "m1.3", contentId: "<img9@x>", size: 5_000_000 }),
          ],
        }),
      ],
    });
    await service.conversation(actor, "box-1", "c", "blocked");
    expect(log.batch).toEqual([["m1.0"]]);
  });

  test("a message with no inline image makes no read, and a failed read leaves the images out", async () => {
    const { service, actor, log } = setup({
      id: "c",
      subject: "x",
      messages: [message("m1", { htmlUnsafe: "<p>hi</p>" })],
    });
    expect(
      (await service.conversation(actor, "box-1", "c", "blocked")).messages[0]!.html,
    ).toContain("hi");
    expect(log.batch).toEqual([]);
  });
});

describe("a conversation as text for a bot", () => {
  test("html-only mail is reduced to words, files are named, and no file is ever read", async () => {
    const { service, actor, log } = setup({
      id: "c",
      subject: "Invoice",
      messages: [
        message("m1", {
          htmlUnsafe:
            '<html><head><style>p{color:red}</style></head><body><p>Hello <b>Ana</b></p><p>Pay <a href="http://evil.example.invalid/x">here</a></p><script>alert(1)</script><img src="cid:logo@x"></body></html>',
          attachments: [
            file({ id: "m1.0", contentId: "<logo@x>" }),
            file({
              id: "m1.1",
              disposition: "attachment",
              fileName: "invoice.pdf",
              contentType: "application/pdf",
              size: 2048,
            }),
          ],
        }),
        message("m2", { text: "Plain words", htmlUnsafe: "<p>ignored html</p>" }),
      ],
    });
    const c = await service.conversationText(actor, "box-1", "c");
    expect(c.messages[0]!.text).toBe("Hello Ana\nPay here");
    expect(c.messages[0]!.files).toEqual([
      { fileName: "invoice.pdf", contentType: "application/pdf", size: 2048 },
    ]);
    expect(c.messages[1]!.text).toBe("Plain words");
    expect(JSON.stringify(c)).not.toMatch(/<\/?[a-z]/i);
    expect(JSON.stringify(c)).not.toContain("evil.example.invalid");
    expect(log.single).toEqual([]);
    expect(log.batch).toEqual([]);
  });
});

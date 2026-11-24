/**
 * The mailbox of an address the installation handed to a bot. Its mail is in Postgres (`messages.ts`), put there by the poller
 * (`poller.ts`), so reading never reaches the provider. Sending goes out through the provider and the copy is stored as `out`
 * (`copy: "saved"`). Conversations are the thread keys the store gave each message when it arrived.
 *
 * Ids: a conversation is its thread key. A message is the id of its row. A file is `<row id>.<index>` (the index `parseMessage` gave it).
 * A page cursor wraps the date and key of the last conversation shown, together with the words of the search.
 */
import { uuidv7 } from "@zetta/core/uuid";
import type {
  AttachmentBytes,
  Conversation,
  ConversationPage,
  ConversationSummary,
  ListQuery,
  MailAddress,
  MailboxDriver,
  MailMessage,
  OutgoingMail,
  SentMail,
} from "../driver";
import { MailConnectError } from "../imap-connect";
import type { MessageStore, StoredMessage, StoredMessageHead } from "../messages";
import {
  extractAttachment,
  extractAttachments,
  oneLine,
  parseMessage,
  PARSE_LIMITS,
} from "../parse";
import type { MailProvider } from "../providers/provider";
import { baseSubject } from "../threading";
import { checkOutgoing, IMAP_LIMITS, snippetOf } from "./imap";

export type ProvisionedDriverOptions = {
  mailbox: { id: string; address: string };
  messages: MessageStore;
  /** The provider, or undefined when the installation has none set up (reading still works; sending does not). */
  provider: () => Promise<MailProvider | undefined>;
  /** The name that appears on a sent message: the bot's own name now, so a rename shows at once. */
  displayName: () => Promise<string>;
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const unb64 = (s: string): unknown => {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
};
const badToken = (what: string) =>
  new MailConnectError(
    "BAD_ID",
    `That ${what} is not valid any more.`,
    "Reload the mailbox and try again.",
  );
type Cursor = { v: 1; k: "p"; d: string; t: string; q: string };

const originOf = (m: Pick<StoredMessageHead, "direction">) =>
  m.direction === "out" ? ("sent" as const) : ("received" as const);

/** What a list shows of a message that is not parsed: the columns the poller kept. */
const addressOfHead = (m: StoredMessageHead): MailAddress => ({
  name: m.fromName,
  address: m.fromAddress,
});

export function createProvisionedDriver(o: ProvisionedDriverOptions): MailboxDriver {
  const own = o.mailbox.address.toLowerCase();

  async function check() {
    const provider = await o.provider();
    if (!provider)
      throw new MailConnectError(
        "NOT_AVAILABLE",
        "Bot e-mail addresses are not set up on this server.",
      );
    const domain = own.split("@")[1] ?? "";
    const s = await provider.domainStatus(domain);
    if (!s.found || !s.receiving || !s.sending)
      throw new MailConnectError(
        "MAIL_ERROR",
        "The domain of this address is not ready to send and receive yet.",
      );
  }

  async function listConversations(q: ListQuery): Promise<ConversationPage> {
    const query = (q.query ?? "").trim().slice(0, IMAP_LIMITS.queryChars);
    let cursor: { d: string; k: string } | undefined;
    if (q.cursor) {
      const c = unb64(q.cursor) as Partial<Cursor> | undefined;
      if (
        !c ||
        c.v !== 1 ||
        c.k !== "p" ||
        typeof c.d !== "string" ||
        typeof c.t !== "string" ||
        c.q !== query
      )
        throw badToken("page");
      cursor = { d: c.d, k: c.t };
    }
    const limit = Math.max(1, Math.min(IMAP_LIMITS.maxPage, q.limit));
    const page = await o.messages.threadPage(o.mailbox.id, {
      ...(query ? { query } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    });
    const heads = await o.messages.heads(
      o.mailbox.id,
      page.threads.map((t) => t.key),
    );
    const byKey = new Map<string, StoredMessageHead[]>();
    for (const h of heads) byKey.set(h.threadKey, [...(byKey.get(h.threadKey) ?? []), h]);
    const conversations: ConversationSummary[] = page.threads.map((t) => {
      const msgs = byKey.get(t.key) ?? [];
      const newest = msgs[msgs.length - 1];
      const people = new Map<string, MailAddress>();
      for (const m of [...msgs].reverse()) {
        const f = addressOfHead(m);
        if (f.address && !people.has(f.address)) people.set(f.address, f);
        for (const a of m.toAddresses)
          if (a && !people.has(a)) people.set(a, { name: "", address: a });
      }
      return {
        id: t.key,
        subject: baseSubject(msgs[0]?.subject ?? "") || "(no subject)",
        participants: [...people.values()].slice(0, 6),
        lastDate: t.last.toISOString(),
        messageCount: msgs.length,
        snippet: newest ? snippetOf(newest.textBody) : "",
        attachments: msgs.some((m) => m.attachments === "some") ? "some" : "none",
      };
    });
    const last = page.threads[page.threads.length - 1];
    return {
      conversations,
      ...(page.more && last
        ? {
            nextCursor: b64({
              v: 1,
              k: "p",
              d: last.last.toISOString(),
              t: last.key,
              q: query,
            } satisfies Cursor),
          }
        : {}),
    };
  }

  async function parsed(row: StoredMessage): Promise<MailMessage> {
    const m = await parseMessage(new Uint8Array(row.rawMime ?? Buffer.alloc(0)), {
      id: row.id,
      origin: originOf(row),
      truncated: false,
    });
    // A message whose source is gone or unreadable still shows the columns that were kept.
    if (m.source === "unreadable" || !row.rawMime)
      return {
        ...m,
        messageId: row.messageId,
        from: row.fromAddress ? { name: row.fromName, address: row.fromAddress } : null,
        to: row.toAddresses.map((a) => ({ name: "", address: a })),
        date: row.date.toISOString(),
        subject: oneLine(row.subject, PARSE_LIMITS.subject),
        text: row.textBody,
      };
    return { ...m, date: m.date ?? row.date.toISOString() };
  }

  async function getConversation(id: string): Promise<Conversation> {
    const rows = await o.messages.thread(o.mailbox.id, id);
    if (!rows.length)
      throw new MailConnectError("NOT_FOUND", "That conversation is no longer in the mailbox.");
    const messages: MailMessage[] = [];
    for (const r of rows) messages.push(await parsed(r));
    return { id, subject: baseSubject(rows[0]!.subject) || "(no subject)", messages };
  }

  const splitFile = (attachmentId: string) => {
    const dot = attachmentId.lastIndexOf(".");
    const row = dot > 0 ? attachmentId.slice(0, dot) : "";
    const index = dot > 0 ? Number(attachmentId.slice(dot + 1)) : NaN;
    if (!/^[0-9a-f-]{36}$/.test(row) || !Number.isInteger(index) || index < 0 || index > 1000)
      throw badToken("attachment");
    return { row, index };
  };

  async function sourceOf(conversationId: string, rowId: string) {
    const r = await o.messages.get(o.mailbox.id, rowId);
    if (!r || r.threadKey !== conversationId || !r.rawMime)
      throw new MailConnectError("NOT_FOUND", "That file is no longer in the mailbox.");
    return new Uint8Array(r.rawMime);
  }

  async function getAttachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<AttachmentBytes> {
    const { row, index } = splitFile(attachmentId);
    const file = await extractAttachment(await sourceOf(conversationId, row), index);
    if (!file) throw new MailConnectError("NOT_FOUND", "That file is no longer in the mailbox.");
    if (file.bytes.length > IMAP_LIMITS.attachmentBytes)
      throw new MailConnectError("TOO_LARGE", "That file is too large to open here.");
    return file;
  }

  async function getAttachments(conversationId: string, ids: string[]) {
    const out = new Map<string, AttachmentBytes>();
    const byRow = new Map<string, { id: string; index: number }[]>();
    for (const id of ids) {
      try {
        const { row, index } = splitFile(id);
        byRow.set(row, [...(byRow.get(row) ?? []), { id, index }]);
      } catch {
        /* left out */
      }
    }
    for (const [row, wanted] of byRow) {
      let source: Uint8Array;
      try {
        source = await sourceOf(conversationId, row);
      } catch {
        continue;
      }
      const files = await extractAttachments(
        source,
        wanted.map((w) => w.index),
      );
      for (const w of wanted) {
        const f = files.get(w.index);
        if (f && f.bytes.length <= IMAP_LIMITS.attachmentBytes) out.set(w.id, f);
      }
    }
    return out;
  }

  async function send(mail: OutgoingMail): Promise<SentMail> {
    checkOutgoing(mail, o.mailbox.address);
    const provider = await o.provider();
    if (!provider)
      throw new MailConnectError(
        "NOT_AVAILABLE",
        "Bot e-mail addresses are not set up on this server.",
      );
    let inReplyTo = "";
    let references: string[] = [];
    if (mail.inReplyTo) {
      const r = /^[0-9a-f-]{36}$/.test(mail.inReplyTo)
        ? await o.messages.get(o.mailbox.id, mail.inReplyTo)
        : undefined;
      if (!r) throw badToken("message");
      if (!r.messageId)
        throw new MailConnectError(
          "NO_MESSAGE_ID",
          "The message to answer has no identifier, so a reply cannot be linked to it.",
        );
      inReplyTo = r.messageId;
      references = [...r.references, r.messageId].slice(-20);
    }
    const domain = own.split("@")[1] ?? "localhost";
    const messageId = `${uuidv7()}@${domain}`;
    const name = oneLine(await o.displayName(), 80);
    const { raw } = await provider.send({
      from: { name, address: o.mailbox.address },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      messageId,
      ...(inReplyTo ? { inReplyTo, references } : {}),
    });
    // The mail has gone: a failure to keep the copy must not look like a failure to send.
    const kept = await o.messages
      .insert({
        mailboxId: o.mailbox.id,
        providerRef: `out-${messageId}`,
        direction: "out",
        messageId,
        inReplyTo,
        references,
        fromAddress: own,
        fromName: name,
        toAddresses: mail.to.map((t) => t.toLowerCase()),
        subject: mail.subject,
        date: new Date(),
        textBody: mail.text,
        authentication: {},
        attachments: "none",
        raw,
      })
      .catch(() => undefined);
    return { messageId, copy: kept ? "saved" : "not_saved" };
  }

  return { check, listConversations, getConversation, getAttachment, getAttachments, send };
}

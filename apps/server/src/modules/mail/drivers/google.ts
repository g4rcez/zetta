/**
 * The Gmail mailbox: a Google account the person already connected in the Google plugin, read through the Gmail API. Nothing is stored
 * for it here: no token, no copy of a message. Every call goes through a `GmailTransport`, which borrows the account's access token from
 * the plugin for that one request (see `integrations/plugins/google/mail-access.ts`).
 *
 * The mailbox is read and never changed. The transport accepts exactly two kinds of call (`isAllowedGmailCall`): a GET of a profile, a
 * thread, a message or one attachment, and the POST that sends a message. There is no call that adds or removes a label, marks a message
 * as read, moves it to the trash or deletes it, so none can be made by a bug in this file either.
 *
 * Gmail files the copy of a sent message by itself, so `send` appends nothing and answers `copy: "provider"`.
 *
 * Ids: a conversation is the Gmail thread id. A message is the Gmail message id. A file is `<message id>.<part id>` (the MIME part's
 * position, which stays the same, unlike the attachment id Gmail hands out, which changes between reads). A page cursor wraps Gmail's
 * page token together with the words of the search, so a cursor of one search is refused for another.
 */
import { uuidv7 } from "@zetta/core/uuid";
import MailComposer from "nodemailer/lib/mail-composer";
import type {
  AttachmentBytes,
  AttachmentInfo,
  Conversation,
  ConversationPage,
  ConversationSummary,
  ListQuery,
  MailAddress,
  MailboxDriver,
  MailMessage,
  MessageOrigin,
  OutgoingMail,
  SentMail,
} from "../driver";
import { MailConnectError } from "../imap-connect";
import { oneLine, PARSE_LIMITS } from "../parse";
import { baseSubject, parseMessageIds } from "../threading";
import { checkOutgoing, IMAP_LIMITS } from "./imap";

/** Bounds that Gmail needs on top of the ones the IMAP driver has (`IMAP_LIMITS`, which this driver shares: page size, sizes, recipients). */
export const GMAIL_LIMITS = {
  /** Thread reads that run at the same time while a page or the files of a message are built. */
  parallel: 4,
  snippetChars: IMAP_LIMITS.snippetChars,
  participants: 6,
} as const;

export type GmailRequest = {
  /** `read` needs the gmail.readonly permission of the account, `send` needs gmail.send. */
  scope: "read" | "send";
  method: "GET" | "POST";
  /** Below `/users/me`. */
  path: string;
  query?: Record<string, string | string[]>;
  json?: unknown;
};
/** Does the call and answers the JSON body. Throws a `MailConnectError`: the words are ours, never Google's. */
export type GmailTransport = (r: GmailRequest) => Promise<unknown>;

const THREAD = /^\/threads(\/[A-Za-z0-9_-]{1,64})?$/;
const MESSAGE = /^\/messages\/[A-Za-z0-9_-]{1,64}(\/attachments\/[A-Za-z0-9_.-]{1,2000})?$/;
/** The only calls this mailbox ever makes. Anything else (labels, modify, trash, delete, batch, drafts) is refused before it leaves. */
export const isAllowedGmailCall = (r: Pick<GmailRequest, "method" | "path">) =>
  r.method === "POST"
    ? r.path === "/messages/send"
    : r.method === "GET" && (r.path === "/profile" || THREAD.test(r.path) || MESSAGE.test(r.path));

// ---- opaque ids -------------------------------------------------------------------------------------------------------------------

const GMAIL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PART_ID = /^[0-9]{1,6}(\.[0-9]{1,6}){0,15}$/;
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
const idOf = (v: string, what: string) => {
  if (!GMAIL_ID.test(v)) throw badToken(what);
  return v;
};
/** `<message id>.<part id>`; the message id has no dot, so the first one splits them. */
export function splitFileId(id: string) {
  const dot = id.indexOf(".");
  const message = dot > 0 ? id.slice(0, dot) : "";
  const part = dot > 0 ? id.slice(dot + 1) : "";
  if (!GMAIL_ID.test(message) || !PART_ID.test(part)) throw badToken("attachment");
  return { message, part };
}
type CursorToken = { v: 1; k: "p"; t: string; q: string };
const encodeCursor = (t: string, q: string) => b64({ v: 1, k: "p", t, q } satisfies CursorToken);
function decodeCursor(c: string): CursorToken {
  const t = unb64(c) as Partial<CursorToken> | undefined;
  if (!t || t.v !== 1 || t.k !== "p" || typeof t.t !== "string" || typeof t.q !== "string")
    throw badToken("page");
  return t as CursorToken;
}

// ---- Gmail's JSON ------------------------------------------------------------------------------------------------------------------

type GHeader = { name?: string; value?: string };
export type GPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GPart[];
};
export type GMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GPart;
};
type GThread = { id?: string; snippet?: string; messages?: GMessage[] };

const objectOf = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const header = (p: GPart | undefined, name: string) => {
  const want = name.toLowerCase();
  for (const h of listOf<GHeader>(p?.headers))
    if (typeof h?.name === "string" && h.name.toLowerCase() === want && typeof h.value === "string")
      return h.value;
  return "";
};
const labels = (m: GMessage) => listOf<string>(m.labelIds).filter((l) => typeof l === "string");

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
/** Gmail's snippet carries HTML entities (`&#39;`, `&amp;`): they are turned back into the characters. */
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const decoderFor = (charset: string | undefined) => {
  try {
    return new TextDecoder((charset || "utf-8").toLowerCase() as "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
};

/** RFC 2047 words (`=?UTF-8?B?...?=`) in a header value, decoded; a value that has none is returned as it is. */
export function decodeWords(value: string): string {
  const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(
    /=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g,
    (whole, charset: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toLowerCase() === "b"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text
                  .replace(/_/g, " ")
                  .replace(/=([0-9a-f]{2})/gi, (_m, h: string) =>
                    String.fromCharCode(parseInt(h, 16)),
                  ),
                "latin1",
              );
        return decoderFor(charset.split("*")[0]).decode(bytes);
      } catch {
        return whole;
      }
    },
  );
}

/** An address header (`Ana <ana@example.com>, bob@example.com`) as people; commas inside quotes or angle brackets do not split it. */
export function parseAddresses(value: string): MailAddress[] {
  const items: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle = true;
    else if (!quoted && ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  const out: MailAddress[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    const m = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/.exec(item);
    const address = (m ? m[2]! : item)
      .replace(/^mailto:/i, "")
      .trim()
      .toLowerCase();
    if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(address)) continue;
    const name = m
      ? decodeWords(
          m[1]!
            .trim()
            .replace(/^"(.*)"$/, "$1")
            .replace(/\\(.)/g, "$1"),
        )
      : "";
    out.push({ name: oneLine(name, 200), address: oneLine(address, 320) });
  }
  return out.slice(0, PARSE_LIMITS.recipients);
}

const whenOf = (m: GMessage): number => {
  const dated = Date.parse(header(m.payload, "date"));
  if (Number.isFinite(dated)) return dated;
  const internal = Number(m.internalDate);
  return Number.isFinite(internal) ? internal : 0;
};
const isoOrNull = (t: number) => (t > 0 ? new Date(t).toISOString() : null);

/** A message of the mailbox's own sending (it carries SENT and is not also in the inbox: mail to oneself is a received message). */
const originOf = (m: GMessage): MessageOrigin => {
  const l = labels(m);
  return l.includes("SENT") && !l.includes("INBOX") ? "sent" : "received";
};
const isDraft = (m: GMessage) => labels(m).includes("DRAFT");

// ---- MIME parts --------------------------------------------------------------------------------------------------------------------

type Collected = {
  bodies: { type: "plain" | "html"; part: GPart }[];
  files: { part: GPart; info: AttachmentInfo }[];
};

/** The text parts and the files of a message, in order. An image the HTML points to by `cid:` is an `inline` file, as in the IMAP driver. */
export function collectParts(messageId: string, root: GPart | undefined): Collected {
  const out: Collected = { bodies: [], files: [] };
  const walk = (p: GPart, related: boolean) => {
    if (listOf<GPart>(p.parts).length) {
      const here = (p.mimeType ?? "").toLowerCase() === "multipart/related";
      for (const c of listOf<GPart>(p.parts)) walk(c, here);
      return;
    }
    const type = (p.mimeType ?? "").toLowerCase();
    const disposition = header(p, "content-disposition").trim().toLowerCase();
    const name = typeof p.filename === "string" ? p.filename : "";
    const cid = oneLine(header(p, "content-id"), 300).replace(/^<|>$/g, "");
    const attached = disposition.startsWith("attachment");
    if ((type === "text/plain" || type === "text/html") && !name && !attached) {
      out.bodies.push({ type: type === "text/html" ? "html" : "plain", part: p });
      return;
    }
    const body = p.body ?? {};
    if (!name && !cid && !body.attachmentId) return;
    if (typeof p.partId !== "string" || !PART_ID.test(p.partId)) return;
    if (out.files.length >= PARSE_LIMITS.attachments) return;
    const inline = Boolean(cid) && (disposition.startsWith("inline") || related);
    out.files.push({
      part: p,
      info: {
        id: `${messageId}.${p.partId}`,
        fileName:
          oneLine(decodeWords(name), PARSE_LIMITS.fileName).replace(/[\\/]/g, "_") ||
          `attachment-${out.files.length + 1}`,
        contentType: oneLine(type, 120) || "application/octet-stream",
        size: Number.isFinite(body.size) ? Number(body.size) : 0,
        disposition: inline ? "inline" : "attachment",
        contentId: cid,
      },
    });
  };
  if (root) walk(root, false);
  return out;
}

const charsetOf = (p: GPart) => /charset\s*=\s*"?([^";\s]+)/i.exec(header(p, "content-type"))?.[1];

/**
 * Whether the message holds a file a person opens (the same idea as the IMAP list: not the image a mail shows inside its text). The
 * list asks Gmail for headers only; when that answer lists no parts, a `multipart/mixed` message is taken as one that has files, since
 * that is the shape a message with attachments has.
 */
const hasFile = (root: GPart | undefined) =>
  collectParts("x", root).files.some((f) => f.info.disposition === "attachment") ||
  (!listOf<GPart>(root?.parts).length &&
    (root?.mimeType ?? "").toLowerCase() === "multipart/mixed");

// ---- small helpers -----------------------------------------------------------------------------------------------------------------

/** Runs `fn` over the items, `n` at a time, and keeps the order of the items. */
export async function mapLimit<T, R>(items: readonly T[], n: number, fn: (x: T) => Promise<R>) {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const tooLarge = () =>
  new MailConnectError(
    "TOO_LARGE",
    `That file is larger than ${IMAP_LIMITS.attachmentBytes / 1_000_000} MB, so it is not downloaded here.`,
  );

export type GoogleDriverOptions = {
  /** The mailbox's own address: what the messages it sends come from. */
  address: string;
  transport: GmailTransport;
};

export function createGoogleDriver(o: GoogleDriverOptions): MailboxDriver {
  const call = (r: GmailRequest) => {
    if (!isAllowedGmailCall(r))
      throw new MailConnectError("BAD_INPUT", "That call is not one this mailbox makes.");
    return o.transport(r);
  };
  const get = async (path: string, scope: "read", query?: GmailRequest["query"]) =>
    objectOf(await call({ scope, method: "GET", path, ...(query ? { query } : {}) }));

  const FULL = { format: "full" } as const;

  /** Reads the body of a text part: inline when Gmail sent it, else the one extra call Gmail needs for a large part. */
  async function textOf(messageId: string, p: GPart): Promise<{ text: string; cut: boolean }> {
    const body = p.body ?? {};
    let data = body.data;
    if (!data && body.attachmentId) {
      if ((body.size ?? 0) > IMAP_LIMITS.messageBytes) return { text: "", cut: true };
      const att = await get(`/messages/${messageId}/attachments/${body.attachmentId}`, "read");
      data = typeof att.data === "string" ? att.data : undefined;
    }
    if (!data) return { text: "", cut: false };
    return { text: decoderFor(charsetOf(p)).decode(Buffer.from(data, "base64url")), cut: false };
  }

  async function toMessage(m: GMessage): Promise<MailMessage> {
    const id = typeof m.id === "string" && GMAIL_ID.test(m.id) ? m.id : "";
    const root = m.payload;
    const parts = collectParts(id, root);
    const texts = await mapLimit(parts.bodies, GMAIL_LIMITS.parallel, async (b) => ({
      type: b.type,
      ...(await textOf(id, b.part).catch((e) => {
        if (e instanceof MailConnectError && e.code !== "AUTH") return { text: "", cut: true };
        throw e;
      })),
    }));
    const join = (t: "plain" | "html") =>
      texts
        .filter((x) => x.type === t)
        .map((x) => x.text)
        .join(t === "plain" ? "\n" : "");
    const text = join("plain");
    const html = join("html");
    const cut =
      texts.some((x) => x.cut) ||
      text.length > PARSE_LIMITS.text ||
      html.length > PARSE_LIMITS.html;
    const first = (name: string) => parseAddresses(decodeWords(header(root, name)));
    return {
      id,
      messageId: parseMessageIds(header(root, "message-id"))[0] ?? "",
      origin: originOf(m),
      from: first("from")[0] ?? null,
      to: first("to"),
      cc: first("cc"),
      replyTo: first("reply-to"),
      date: isoOrNull(whenOf(m)),
      subject: oneLine(decodeWords(header(root, "subject")), PARSE_LIMITS.subject),
      text: text.slice(0, PARSE_LIMITS.text),
      htmlUnsafe: html.slice(0, PARSE_LIMITS.html),
      attachments: parts.files.map((f) => f.info),
      source: cut ? "truncated" : "complete",
    };
  }

  function summaryOf(t: GThread): ConversationSummary | undefined {
    const id = typeof t.id === "string" && GMAIL_ID.test(t.id) ? t.id : "";
    const msgs = listOf<GMessage>(t.messages).filter((m) => !isDraft(m));
    if (!id || !msgs.length) return undefined;
    const newest = msgs[msgs.length - 1]!;
    const people = new Map<string, MailAddress>();
    for (const m of [...msgs].reverse())
      for (const f of ["from", "to"])
        for (const p of parseAddresses(decodeWords(header(m.payload, f))))
          if (!people.has(p.address)) people.set(p.address, p);
    const lastTime = Math.max(...msgs.map(whenOf), 0);
    const internal = Math.max(...msgs.map((m) => Number(m.internalDate) || 0), 0);
    return {
      id,
      subject: baseSubject(
        oneLine(decodeWords(header(msgs[0]!.payload, "subject")), IMAP_LIMITS.subject),
      ),
      participants: [...people.values()].slice(0, GMAIL_LIMITS.participants),
      lastDate: new Date(internal || lastTime || 0).toISOString(),
      messageCount: msgs.length,
      snippet: oneLine(
        decodeEntities(newest.snippet ?? t.snippet ?? ""),
        GMAIL_LIMITS.snippetChars,
      ),
      attachments: msgs.some((m) => hasFile(m.payload)) ? "some" : "none",
    };
  }

  async function listConversations(q: ListQuery): Promise<ConversationPage> {
    const limit = Math.max(1, Math.min(IMAP_LIMITS.maxPage, Math.floor(q.limit) || 1));
    const query = oneLine(q.query, IMAP_LIMITS.queryChars);
    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    if (cursor && cursor.q !== query) throw badToken("page");
    const page = await get("/threads", "read", {
      labelIds: "INBOX",
      maxResults: String(limit),
      ...(query ? { q: query } : {}),
      ...(cursor ? { pageToken: cursor.t } : {}),
    });
    const ids = listOf<{ id?: unknown }>(page.threads)
      .map((t) => t?.id)
      .filter((x): x is string => typeof x === "string" && GMAIL_ID.test(x))
      .slice(0, limit);
    const found = await mapLimit(ids, GMAIL_LIMITS.parallel, async (id) => {
      try {
        const t = await get(`/threads/${id}`, "read", {
          format: "metadata",
          metadataHeaders: ["From", "To", "Cc", "Subject", "Date", "Message-ID"],
        });
        return summaryOf({ ...(t as GThread), id });
      } catch (e) {
        if (e instanceof MailConnectError && e.code === "NOT_FOUND") return undefined; // gone since the list was made
        throw e;
      }
    });
    const next = typeof page.nextPageToken === "string" ? page.nextPageToken : "";
    return {
      conversations: found.filter((c): c is ConversationSummary => Boolean(c)),
      ...(next ? { nextCursor: encodeCursor(next, query) } : {}),
    };
  }

  async function getConversation(id: string): Promise<Conversation> {
    const threadId = idOf(id, "conversation");
    const t = (await get(`/threads/${threadId}`, "read", FULL)) as GThread;
    const msgs = listOf<GMessage>(t.messages)
      .filter((m) => !isDraft(m) && typeof m.id === "string")
      .slice(-IMAP_LIMITS.conversationMessages);
    if (!msgs.length)
      throw new MailConnectError("NOT_FOUND", "That conversation is no longer in the mailbox.");
    const messages = await mapLimit(msgs, GMAIL_LIMITS.parallel, toMessage);
    return { id, subject: baseSubject(messages[0]?.subject ?? ""), messages };
  }

  /** One message with all its parts, and the files in it; the message must be in the conversation the caller named. */
  async function messageFiles(conversationId: string, messageId: string) {
    const m = (await get(`/messages/${messageId}`, "read", FULL)) as GMessage;
    if (m.threadId !== conversationId || m.id !== messageId)
      throw new MailConnectError("NOT_FOUND", "That file is not in the message.");
    return collectParts(messageId, m.payload).files;
  }

  async function bytesOf(messageId: string, f: { part: GPart; info: AttachmentInfo }) {
    const body = f.part.body ?? {};
    if ((body.size ?? f.info.size) > IMAP_LIMITS.attachmentBytes) throw tooLarge();
    let data = body.data;
    if (!data && body.attachmentId) {
      const att = await get(`/messages/${messageId}/attachments/${body.attachmentId}`, "read");
      data = typeof att.data === "string" ? att.data : undefined;
    }
    if (data === undefined)
      throw new MailConnectError("NOT_FOUND", "That file is not in the message.");
    const bytes = new Uint8Array(Buffer.from(data, "base64url"));
    if (bytes.length > IMAP_LIMITS.attachmentBytes) throw tooLarge();
    return { fileName: f.info.fileName, contentType: f.info.contentType, bytes } as AttachmentBytes;
  }

  async function getAttachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<AttachmentBytes> {
    const convo = idOf(conversationId, "conversation");
    const { message } = splitFileId(attachmentId);
    const file = (await messageFiles(convo, message)).find((f) => f.info.id === attachmentId);
    if (!file) throw new MailConnectError("NOT_FOUND", "That file is not in the message.");
    return bytesOf(message, file);
  }

  async function getAttachments(
    conversationId: string,
    attachmentIds: string[],
  ): Promise<Map<string, AttachmentBytes>> {
    const convo = idOf(conversationId, "conversation");
    const byMessage = new Map<string, string[]>();
    for (const id of attachmentIds) {
      const { message } = splitFileId(id);
      byMessage.set(message, [...(byMessage.get(message) ?? []), id]);
    }
    const out = new Map<string, AttachmentBytes>();
    for (const [message, ids] of byMessage) {
      let files: Awaited<ReturnType<typeof messageFiles>>;
      try {
        files = await messageFiles(convo, message);
      } catch (e) {
        if (e instanceof MailConnectError && e.code === "NOT_FOUND") continue;
        throw e;
      }
      for (const id of ids) {
        const file = files.find((f) => f.info.id === id);
        if (!file) continue;
        try {
          out.set(id, await bytesOf(message, file));
        } catch (e) {
          if (e instanceof MailConnectError && ["NOT_FOUND", "TOO_LARGE"].includes(e.code))
            continue;
          throw e;
        }
      }
    }
    return out;
  }

  async function check() {
    await get("/profile", "read");
  }

  async function send(mail: OutgoingMail): Promise<SentMail> {
    checkOutgoing(mail, o.address);
    let threading: { inReplyTo?: string; references?: string[] } = {};
    let threadId: string | undefined;
    if (mail.inReplyTo) {
      const ref = idOf(mail.inReplyTo, "message");
      let head: Record<string, unknown>;
      try {
        head = await get(`/messages/${ref}`, "read", {
          format: "metadata",
          metadataHeaders: ["Message-ID", "References", "In-Reply-To"],
        });
      } catch (e) {
        if (e instanceof MailConnectError && e.code === "NOT_FOUND")
          throw new MailConnectError(
            "NOT_FOUND",
            "The message to answer is no longer in the mailbox.",
          );
        throw e;
      }
      const payload = head.payload as GPart | undefined;
      const messageId = parseMessageIds(header(payload, "message-id"))[0] ?? "";
      if (!messageId)
        throw new MailConnectError(
          "NO_MESSAGE_ID",
          "The message to answer has no identifier, so a reply cannot be linked to it.",
        );
      const references = parseMessageIds(header(payload, "references"));
      threading = {
        inReplyTo: `<${messageId}>`,
        references: [...references, messageId].slice(-20).map((x) => `<${x}>`),
      };
      if (typeof head.threadId === "string" && GMAIL_ID.test(head.threadId))
        threadId = head.threadId;
    }
    const messageId = `<${uuidv7()}@${o.address.split("@")[1] ?? "localhost"}>`;
    const raw = await new MailComposer({
      from: o.address,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      messageId,
      date: new Date(),
      ...threading,
    })
      .compile()
      .build();
    await call({
      scope: "send",
      method: "POST",
      path: "/messages/send",
      json: { raw: raw.toString("base64url"), ...(threadId ? { threadId } : {}) },
    });
    return { messageId: messageId.replace(/^<|>$/g, ""), copy: "provider" };
  }

  return { check, listConversations, getConversation, getAttachment, getAttachments, send };
}

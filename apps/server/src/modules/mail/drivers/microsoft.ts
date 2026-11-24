/**
 * The Microsoft mailbox: an Outlook.com or Microsoft 365 account the person already connected in the Microsoft plugin, read through
 * Microsoft Graph. Nothing is stored for it here: no token, no copy of a message. Every call goes through a `GraphTransport`, which borrows
 * the account's access token from the plugin for that one request (see `integrations/plugins/microsoft/mail-access.ts`).
 *
 * The mailbox is read and never changed. The transport accepts a short list of calls (`isAllowedGraphCall`): GETs of the profile, a folder
 * id, the Inbox list, the messages of one conversation, one message's conversation id, its attachment list and one attachment's bytes,
 * and two POSTs that send mail (`sendMail` and `reply`). There is no call that marks a message as read, moves, flags, deletes or drafts,
 * so none can be made by a bug in this file either. A reply uses the `reply` action (Mail.Send), not `createReply` plus a send, because
 * `createReply` makes a draft and needs Mail.ReadWrite, which would let Zetta change the whole mailbox.
 *
 * Exchange files the copy of a sent message in Sent Items by itself, so `send` appends nothing and answers `copy: "provider"`. Neither
 * Graph action says which Message-ID the sent message got, so `messageId` is empty.
 *
 * Ids: a conversation is the Graph `conversationId`. A message is its Graph id (the transport asks for immutable ids, so a move does not
 * change it). A file is `<message id>.<attachment id>` (Graph ids hold no dot). A page cursor wraps Graph's `@odata.nextLink` together
 * with the words of the search; only the query part of the link is read back, so a cursor can never point the call at another address.
 */
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
import { htmlToText } from "../sanitize";
import { baseSubject } from "../threading";
import { checkOutgoing, IMAP_LIMITS } from "./imap";
import { mapLimit } from "./google";

/** Bounds Graph needs on top of the ones the IMAP driver has (`IMAP_LIMITS`, shared: page size, sizes, recipients). */
export const GRAPH_LIMITS = {
  /** Requests that run at the same time while a conversation is built (Graph allows four at once per app and mailbox). */
  parallel: 4,
  snippetChars: IMAP_LIMITS.snippetChars,
  participants: 6,
  /** Messages asked for in one conversation read; the newest `IMAP_LIMITS.conversationMessages` are kept. */
  conversationFetch: 100,
} as const;

export type GraphRequest = {
  /** `read` needs Mail.Read of the account, `send` needs Mail.Send. */
  scope: "read" | "send";
  method: "GET" | "POST";
  /** Below `/v1.0`, starting with `/me`. */
  path: string;
  query?: Record<string, string>;
  json?: unknown;
  /** What the answer is: JSON (default) or the raw bytes of a file. A POST that answers nothing gives `{}`. */
  as?: "json" | "bytes";
};
/** Does the call and answers the JSON body (or the bytes). Throws a `MailConnectError`: the words are ours, never Microsoft's. */
export type GraphTransport = (r: GraphRequest) => Promise<unknown>;

const ID = "[A-Za-z0-9_=-]{1,512}";
const READ_PATHS = [
  /^\/me$/,
  /^\/me\/mailFolders\/(?:inbox\/messages|sentitems|deleteditems|junkemail)$/,
  /^\/me\/messages$/,
  new RegExp(`^/me/messages/${ID}$`),
  new RegExp(`^/me/messages/${ID}/attachments$`),
  new RegExp(`^/me/messages/${ID}/attachments/${ID}/\\$value$`),
];
const SEND_PATHS = [/^\/me\/sendMail$/, new RegExp(`^/me/messages/${ID}/reply$`)];
/** The only calls this mailbox ever makes. Anything else (move, patch, delete, flags, drafts, createReply) is refused before it leaves. */
export const isAllowedGraphCall = (r: Pick<GraphRequest, "method" | "path">) =>
  r.method === "POST"
    ? SEND_PATHS.some((p) => p.test(r.path))
    : r.method === "GET" && READ_PATHS.some((p) => p.test(r.path));

// ---- opaque ids -------------------------------------------------------------------------------------------------------------------

const GRAPH_ID = new RegExp(`^${ID}$`);
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
  if (!GRAPH_ID.test(v)) throw badToken(what);
  return v;
};
/** `<message id>.<attachment id>`; a Graph id has no dot, so the first one splits them. */
export function splitFileId(id: string) {
  const dot = id.indexOf(".");
  const message = dot > 0 ? id.slice(0, dot) : "";
  const file = dot > 0 ? id.slice(dot + 1) : "";
  if (!GRAPH_ID.test(message) || !GRAPH_ID.test(file)) throw badToken("attachment");
  return { message, file };
}

/** The query keys a cursor may carry back; everything else in a next link is dropped. */
const CURSOR_KEYS = ["$select", "$top", "$orderby", "$search", "$skip", "$skiptoken"] as const;
type CursorToken = { v: 1; k: "n"; u: string; q: string };
const encodeCursor = (u: string, q: string) => b64({ v: 1, k: "n", u, q } satisfies CursorToken);
function decodeCursor(c: string): CursorToken {
  const t = unb64(c) as Partial<CursorToken> | undefined;
  if (!t || t.v !== 1 || t.k !== "n" || typeof t.u !== "string" || typeof t.q !== "string")
    throw badToken("page");
  return t as CursorToken;
}
/** The query of a next link of the Inbox list, only for the keys above. A link to anything else is refused. */
function queryOfNextLink(link: string): Record<string, string> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw badToken("page");
  }
  if (!/^\/v1\.0\/me\/mailFolders\/inbox\/messages$/i.test(url.pathname)) throw badToken("page");
  const out: Record<string, string> = {};
  for (const k of CURSOR_KEYS) {
    const v = url.searchParams.get(k);
    if (v !== null) out[k] = v.slice(0, 2000);
  }
  return out;
}

// ---- Graph's JSON -----------------------------------------------------------------------------------------------------------------

type GRecipient = { emailAddress?: { name?: string; address?: string } };
export type GMessage = {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GRecipient;
  sender?: GRecipient;
  toRecipients?: GRecipient[];
  ccRecipients?: GRecipient[];
  replyTo?: GRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  parentFolderId?: string;
};
export type GAttachment = {
  "@odata.type"?: string;
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
};

const objectOf = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const SMTP = /^[^\s<>@,;"]+@[^\s<>@,;"]+$/;
const personOf = (r: GRecipient | undefined): MailAddress | null => {
  const address = (r?.emailAddress?.address ?? "").trim().toLowerCase();
  if (!SMTP.test(address)) return null;
  return {
    name: oneLine(r?.emailAddress?.name ?? "", 200),
    address: oneLine(address, 320),
  };
};
const peopleOf = (list: unknown): MailAddress[] =>
  listOf<GRecipient>(list)
    .map(personOf)
    .filter((p): p is MailAddress => p !== null)
    .slice(0, PARSE_LIMITS.recipients);

const timeOf = (m: GMessage): number => {
  for (const v of [m.sentDateTime, m.receivedDateTime]) {
    const t = Date.parse(v ?? "");
    if (Number.isFinite(t)) return t;
  }
  return 0;
};
const isoOrNull = (t: number) => (t > 0 ? new Date(t).toISOString() : null);

const tooLarge = () =>
  new MailConnectError(
    "TOO_LARGE",
    `That file is larger than ${IMAP_LIMITS.attachmentBytes / 1_000_000} MB, so it is not downloaded here.`,
  );

const LIST_SELECT =
  "id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,isDraft";
const MESSAGE_SELECT =
  "id,conversationId,internetMessageId,subject,body,from,sender,toRecipients,ccRecipients,replyTo,receivedDateTime,sentDateTime,hasAttachments,isDraft,parentFolderId";
const FILE_TYPE = "#microsoft.graph.fileAttachment";

export type MicrosoftDriverOptions = {
  /** The mailbox's own address. */
  address: string;
  transport: GraphTransport;
};

export function createMicrosoftDriver(o: MicrosoftDriverOptions): MailboxDriver {
  const call = (r: GraphRequest) => {
    if (!isAllowedGraphCall(r))
      throw new MailConnectError("BAD_INPUT", "That call is not one this mailbox makes.");
    return o.transport(r);
  };
  const get = async (path: string, query?: Record<string, string>) =>
    objectOf(await call({ scope: "read", method: "GET", path, ...(query ? { query } : {}) }));

  // ---- list ----------------------------------------------------------------------------------------------------------------------

  /** Messages of one page that share a conversation are one row. The count is the messages on this page, so it can undercount (see the report of this driver). */
  function summaryOf(messages: GMessage[]): ConversationSummary | undefined {
    const live = messages.filter((m) => !m.isDraft);
    const newest = live[0];
    const id = newest?.conversationId;
    if (!newest || typeof id !== "string" || !GRAPH_ID.test(id)) return undefined;
    const people = new Map<string, MailAddress>();
    for (const m of live)
      for (const p of [personOf(m.from), ...listOf<GRecipient>(m.toRecipients).map(personOf)])
        if (p && !people.has(p.address)) people.set(p.address, p);
    return {
      id,
      subject: baseSubject(oneLine(newest.subject ?? "", IMAP_LIMITS.subject)),
      participants: [...people.values()].slice(0, GRAPH_LIMITS.participants),
      lastDate: new Date(Math.max(...live.map(timeOf), 0)).toISOString(),
      messageCount: live.length,
      snippet: oneLine(newest.bodyPreview ?? "", GRAPH_LIMITS.snippetChars),
      attachments: live.some((m) => m.hasAttachments) ? "some" : "none",
    };
  }

  /**
   * One request per page: the Inbox messages, newest first, with the fields a row needs and no body. A search (`$search`) replaces the
   * order (Graph sorts a search by date itself and refuses `$orderby` with it) and returns at most 1000 results. The rows are the
   * conversations of those messages, grouped here. One request keeps a page inside Graph's limit of four concurrent requests; the price
   * is that a conversation's count only covers its messages on the page, and one that continues on the next page shows up there again.
   */
  async function listConversations(q: ListQuery): Promise<ConversationPage> {
    const limit = Math.max(1, Math.min(IMAP_LIMITS.maxPage, Math.floor(q.limit) || 1));
    const query = oneLine(q.query, IMAP_LIMITS.queryChars);
    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    if (cursor && cursor.q !== query) throw badToken("page");
    const params: Record<string, string> = cursor
      ? queryOfNextLink(cursor.u)
      : {
          $select: LIST_SELECT,
          $top: String(limit),
          ...(query
            ? { $search: `"${query.replace(/[\\"]/g, (c) => `\\${c}`)}"` }
            : { $orderby: "receivedDateTime desc" }),
        };
    const page = await get("/me/mailFolders/inbox/messages", params);
    const groups = new Map<string, GMessage[]>();
    for (const m of listOf<GMessage>(page.value)) {
      const c = typeof m?.conversationId === "string" ? m.conversationId : "";
      if (!c) continue;
      groups.set(c, [...(groups.get(c) ?? []), m]);
    }
    const next = typeof page["@odata.nextLink"] === "string" ? page["@odata.nextLink"] : "";
    return {
      conversations: [...groups.values()]
        .map(summaryOf)
        .filter((c): c is ConversationSummary => Boolean(c)),
      ...(next ? { nextCursor: encodeCursor(next, query) } : {}),
    };
  }

  // ---- conversation --------------------------------------------------------------------------------------------------------------

  /** The ids of the folders whose messages are not part of a conversation here (Deleted Items, Junk) or are the person's own (Sent Items). */
  async function folderIds() {
    const one = async (name: string) => {
      try {
        const f = await get(`/me/mailFolders/${name}`, { $select: "id" });
        return typeof f.id === "string" ? f.id : "";
      } catch (e) {
        if (e instanceof MailConnectError && e.code === "NOT_FOUND") return "";
        throw e;
      }
    };
    const [sent, deleted, junk] = await Promise.all([
      one("sentitems"),
      one("deleteditems"),
      one("junkemail"),
    ]);
    return { sent, hidden: new Set([deleted, junk].filter(Boolean)) };
  }

  /** The files of one message. Only real files (`fileAttachment`): an attached message or a link is not listed. */
  async function filesOf(messageId: string): Promise<AttachmentInfo[]> {
    const path = `/me/messages/${messageId}/attachments`;
    let list: Record<string, unknown>;
    try {
      list = await get(path, { $select: "id,name,contentType,size,isInline,contentId" });
    } catch (e) {
      // A server that does not take the narrow list answers the full one (the bytes in it are dropped at once).
      if (!(e instanceof MailConnectError && e.code === "BAD_INPUT")) throw e;
      list = await get(path);
    }
    const out: AttachmentInfo[] = [];
    for (const a of listOf<GAttachment>(list.value)) {
      if (out.length >= PARSE_LIMITS.attachments) break;
      if (typeof a?.id !== "string" || !GRAPH_ID.test(a.id)) continue;
      if (a["@odata.type"] !== undefined && a["@odata.type"] !== FILE_TYPE) continue;
      const cid = oneLine(a.contentId ?? "", 300).replace(/^<|>$/g, "");
      out.push({
        id: `${messageId}.${a.id}`,
        fileName:
          oneLine(a.name ?? "", PARSE_LIMITS.fileName).replace(/[\\/]/g, "_") ||
          `attachment-${out.length + 1}`,
        contentType: oneLine(a.contentType ?? "", 120) || "application/octet-stream",
        size: Number.isFinite(a.size) ? Number(a.size) : 0,
        disposition: a.isInline === true && cid ? "inline" : "attachment",
        contentId: cid,
      });
    }
    return out;
  }

  async function toMessage(m: GMessage, sentFolder: string): Promise<MailMessage> {
    const id = typeof m.id === "string" && GRAPH_ID.test(m.id) ? m.id : "";
    const isHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
    const content = typeof m.body?.content === "string" ? m.body.content : "";
    const html = isHtml ? content.slice(0, PARSE_LIMITS.html) : "";
    const text = isHtml ? htmlToText(content) : content;
    const wantsFiles = Boolean(m.hasAttachments) || /\bcid:/i.test(html);
    let attachments: AttachmentInfo[] = [];
    if (id && wantsFiles) attachments = await filesOf(id);
    const cut =
      (isHtml && content.length > PARSE_LIMITS.html) ||
      (!isHtml && content.length > PARSE_LIMITS.text);
    return {
      id,
      messageId: oneLine(m.internetMessageId ?? "", 300).replace(/^<|>$/g, ""),
      origin: (sentFolder && m.parentFolderId === sentFolder
        ? "sent"
        : "received") as MessageOrigin,
      from: personOf(m.from ?? m.sender),
      to: peopleOf(m.toRecipients),
      cc: peopleOf(m.ccRecipients),
      replyTo: peopleOf(m.replyTo),
      date: isoOrNull(timeOf(m)),
      subject: oneLine(m.subject ?? "", PARSE_LIMITS.subject),
      text: text.slice(0, PARSE_LIMITS.text),
      htmlUnsafe: html,
      attachments,
      source: cut ? "truncated" : "complete",
    };
  }

  /**
   * Every message of the conversation in every folder (`/me/messages` covers them all, the person's own replies in Sent Items among them)
   * with one filtered request. Graph refuses `$orderby` on a property the filter does not name, so the order is made here. Drafts and
   * what sits in Deleted Items or Junk are left out; a message that is both in the Inbox and in Sent Items (mail to oneself) is shown once.
   */
  async function getConversation(id: string): Promise<Conversation> {
    const conversationId = idOf(id, "conversation");
    const [page, folders] = await Promise.all([
      get("/me/messages", {
        $filter: `conversationId eq '${conversationId}'`,
        $select: MESSAGE_SELECT,
        $top: String(GRAPH_LIMITS.conversationFetch),
      }),
      folderIds(),
    ]);
    const all = listOf<GMessage>(page.value).filter(
      (m) =>
        typeof m?.id === "string" &&
        m.conversationId === conversationId &&
        !m.isDraft &&
        !(m.parentFolderId && folders.hidden.has(m.parentFolderId)),
    );
    const seen = new Map<string, GMessage>();
    const kept: GMessage[] = [];
    for (const m of all) {
      const key = m.internetMessageId ?? "";
      const twin = key ? seen.get(key) : undefined;
      if (twin) {
        // The copy in Sent Items yields to the one that was received.
        if (twin.parentFolderId === folders.sent && m.parentFolderId !== folders.sent)
          kept[kept.indexOf(twin)] = m;
        continue;
      }
      if (key) seen.set(key, m);
      kept.push(m);
    }
    const msgs = kept
      .sort((a, b) => timeOf(a) - timeOf(b))
      .slice(-IMAP_LIMITS.conversationMessages);
    if (!msgs.length)
      throw new MailConnectError("NOT_FOUND", "That conversation is no longer in the mailbox.");
    const messages = await mapLimit(msgs, GRAPH_LIMITS.parallel, (m) => toMessage(m, folders.sent));
    return { id, subject: baseSubject(messages[0]?.subject ?? ""), messages };
  }

  // ---- files ---------------------------------------------------------------------------------------------------------------------

  /** The message must be in the conversation the caller named, so a file id of another conversation is not served. */
  async function inConversation(conversationId: string, messageId: string) {
    const m = await get(`/me/messages/${messageId}`, { $select: "id,conversationId" });
    if (m.conversationId !== conversationId)
      throw new MailConnectError("NOT_FOUND", "That file is not in the message.");
  }

  async function bytesOf(messageId: string, info: AttachmentInfo): Promise<AttachmentBytes> {
    if (info.size > IMAP_LIMITS.attachmentBytes) throw tooLarge();
    const attachmentId = info.id.slice(messageId.length + 1);
    const raw = await call({
      scope: "read",
      method: "GET",
      path: `/me/messages/${messageId}/attachments/${attachmentId}/$value`,
      as: "bytes",
    });
    if (!(raw instanceof Uint8Array))
      throw new MailConnectError("NOT_FOUND", "That file is not in the message.");
    if (raw.length > IMAP_LIMITS.attachmentBytes) throw tooLarge();
    return { fileName: info.fileName, contentType: info.contentType, bytes: raw };
  }

  async function getAttachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<AttachmentBytes> {
    const convo = idOf(conversationId, "conversation");
    const { message } = splitFileId(attachmentId);
    await inConversation(convo, message);
    const info = (await filesOf(message)).find((f) => f.id === attachmentId);
    if (!info) throw new MailConnectError("NOT_FOUND", "That file is not in the message.");
    return bytesOf(message, info);
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
      let files: AttachmentInfo[];
      try {
        await inConversation(convo, message);
        files = await filesOf(message);
      } catch (e) {
        if (e instanceof MailConnectError && e.code === "NOT_FOUND") continue;
        throw e;
      }
      for (const id of ids) {
        const info = files.find((f) => f.id === id);
        if (!info) continue;
        try {
          out.set(id, await bytesOf(message, info));
        } catch (e) {
          if (e instanceof MailConnectError && ["NOT_FOUND", "TOO_LARGE"].includes(e.code))
            continue;
          throw e;
        }
      }
    }
    return out;
  }

  // ---- check and send ------------------------------------------------------------------------------------------------------------

  async function check() {
    await get("/me", { $select: "id" });
  }

  const recipients = (to: string[]) => to.map((address) => ({ emailAddress: { address } }));

  /**
   * A new message goes out with `sendMail`; an answer with the `reply` action on the message being answered, which Outlook threads and
   * quotes itself. The recipients are the ones the server worked out (they replace Outlook's own choice of "From" over "Reply-To").
   * The subject of an answer is Outlook's ("RE: ..."). Both save the message in Sent Items.
   */
  async function send(mail: OutgoingMail): Promise<SentMail> {
    checkOutgoing(mail, o.address);
    if (mail.inReplyTo) {
      const ref = idOf(mail.inReplyTo, "message");
      try {
        await call({
          scope: "send",
          method: "POST",
          path: `/me/messages/${ref}/reply`,
          json: { message: { toRecipients: recipients(mail.to) }, comment: mail.text },
        });
      } catch (e) {
        if (e instanceof MailConnectError && e.code === "NOT_FOUND")
          throw new MailConnectError(
            "NOT_FOUND",
            "The message to answer is no longer in the mailbox.",
          );
        throw e;
      }
    } else
      await call({
        scope: "send",
        method: "POST",
        path: "/me/sendMail",
        json: {
          message: {
            subject: mail.subject,
            body: { contentType: "Text", content: mail.text },
            toRecipients: recipients(mail.to),
          },
          saveToSentItems: true,
        },
      });
    return { messageId: "", copy: "provider" };
  }

  return { check, listConversations, getConversation, getAttachment, getAttachments, send };
}

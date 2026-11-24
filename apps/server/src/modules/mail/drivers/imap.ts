/**
 * The IMAP and SMTP mailbox: any server a person can reach with a user name and a password. Built from a mailbox's settings and the
 * password handed in; it never reads the connections store.
 *
 * Mail is read live from the server on each call and nothing is copied. The mailbox is opened read-only (EXAMINE) and every fetch is a
 * peek, so no message is ever marked as read, flagged, moved or deleted. The one write is `send`: after the SMTP server took a message,
 * the same bytes are appended to the sent folder (the one marked `\Sent`, else a common name; none is created), so the person finds it in
 * their own mail app and in the conversation. A failed append never undoes the send; the result says the copy was not saved.
 *
 * Connections: one per mailbox, kept in server memory for `IMAP_LIMITS.idleMs` of idleness, then closed (and closed on any error). Calls
 * for the same mailbox wait in a queue, so they never open a second connection or interleave commands.
 */
import { createHash } from "node:crypto";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import { uuidv7 } from "@zetta/core/uuid";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type {
  AttachmentBytes,
  Conversation,
  ConversationPage,
  ConversationSummary,
  ListQuery,
  MailAddress,
  MailboxDriver,
  MailMessage,
  MessageOrigin,
  OutgoingMail,
  SentCopy,
  SentMail,
} from "../driver";
import {
  assertMailHosts,
  imapOptions,
  MailConnectError,
  mailFailure,
  smtpOptions,
  type MailServer,
} from "../imap-connect";
import {
  extractAttachment,
  extractAttachments,
  isControl,
  oneLine,
  parseMessage,
  parseThreadHeaders,
} from "../parse";
import { baseSubject, groupConversations, parseMessageIds, type ThreadMessage } from "../threading";

/** Every bound in one place. */
export const IMAP_LIMITS = {
  /** A connection with nothing to do is closed after this long. */
  idleMs: 60_000,
  /** One call, connection included, gives up after this long. */
  operationMs: 30_000,
  /** Headers read to build the list: the newest this many messages (and as many more above a page cursor, to recognise a conversation the earlier page already showed). */
  scan: 300,
  /** A page of conversations. */
  maxPage: 50,
  /** A message source longer than this is read only up to this many bytes. */
  messageBytes: 1_000_000,
  /** The messages of one conversation, received and sent together. */
  conversationMessages: 60,
  /** Message ids asked about in one search while a conversation is completed. */
  idsPerSearch: 20,
  /** Rounds of "who else mentions these ids" when a conversation is opened. */
  expandRounds: 3,
  /** Bytes read to make a snippet. */
  snippetBytes: 4096,
  snippetChars: 160,
  /** A file larger than this (decoded) is not handed out. */
  attachmentBytes: 10_000_000,
  /** The words of a search, in characters. */
  queryChars: 200,
  subject: 998,
  bodyChars: 100_000,
  recipients: 20,
} as const;

/** Source bytes read for an attachment: the file as base64 plus the rest of the message. */
const ATTACHMENT_SOURCE = Math.ceil(IMAP_LIMITS.attachmentBytes * 1.4) + 1_000_000;

// ---- pure helpers (unit tested) ------------------------------------------------------------------------------------------------

/** `[1,2,3,7]` as `"1:3,7"`. */
export const uidSet = (uids: readonly number[]) => {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j > i ? `${sorted[i]}:${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(",");
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const unb64 = (s: string): unknown => {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
};

/** What an opaque id or cursor holds. `vl` is the folder's UIDVALIDITY: when the server rebuilds the folder, every old id is refused. */
export type ConversationToken = { v: 1; k: "c"; vl: string; u: number[] };
export type MessageToken = { v: 1; k: "m"; vl: string; o: MessageOrigin; f: string; u: number };
export type CursorToken = { v: 1; k: "p"; vl: string; b: number; q: string };

const isUid = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

export const encodeToken = (t: ConversationToken | MessageToken | CursorToken) => b64(t);
const badToken = (what: string) =>
  new MailConnectError(
    "BAD_ID",
    `That ${what} is not valid any more.`,
    "Reload the mailbox and try again.",
  );
export function decodeConversation(id: string): ConversationToken {
  const t = unb64(id) as Partial<ConversationToken> | undefined;
  if (
    !t ||
    t.v !== 1 ||
    t.k !== "c" ||
    typeof t.vl !== "string" ||
    !Array.isArray(t.u) ||
    !t.u.length ||
    t.u.length > IMAP_LIMITS.conversationMessages ||
    !t.u.every(isUid)
  )
    throw badToken("conversation");
  return t as ConversationToken;
}
export function decodeCursor(c: string): CursorToken {
  const t = unb64(c) as Partial<CursorToken> | undefined;
  if (
    !t ||
    t.v !== 1 ||
    t.k !== "p" ||
    typeof t.vl !== "string" ||
    typeof t.q !== "string" ||
    !isUid(t.b)
  )
    throw badToken("page");
  return t as CursorToken;
}
export function decodeMessage(id: string): MessageToken {
  const t = unb64(id) as Partial<MessageToken> | undefined;
  if (
    !t ||
    t.v !== 1 ||
    t.k !== "m" ||
    typeof t.vl !== "string" ||
    typeof t.f !== "string" ||
    (t.o !== "received" && t.o !== "sent") ||
    !isUid(t.u)
  )
    throw badToken("message");
  return t as MessageToken;
}

const SENT_NAMES = [
  "sent",
  "sent items",
  "sent mail",
  "sent messages",
  "enviados",
  "itens enviados",
  "mensagens enviadas",
  "gesendet",
  "gesendete elemente",
  "envoyés",
  "éléments envoyés",
  "inviata",
  "posta inviata",
  "[gmail]/sent mail",
  "[google mail]/sent mail",
];

/** The folder the person's own messages go to: the one the server marks `\Sent`, else a common name (also under `INBOX.`). */
export function findSentFolder(
  boxes: readonly {
    path: string;
    delimiter?: string;
    specialUse?: string;
    flags?: Iterable<string>;
  }[],
): string | undefined {
  const usable = boxes.filter((b) => ![...(b.flags ?? [])].some((f) => /^\\noselect$/i.test(f)));
  const marked = usable.find((b) => b.specialUse === "\\Sent");
  if (marked) return marked.path;
  const norm = (p: string, d?: string) => {
    const lower = p.toLowerCase();
    return d && lower.startsWith(`inbox${d}`) ? lower.slice(6) : lower;
  };
  for (const name of SENT_NAMES) {
    const hit = usable.find((b) => norm(b.path, b.delimiter) === name);
    if (hit) return hit.path;
  }
  return undefined;
}

/** The first words of a message: quoted lines and blank space dropped, one line. */
export function snippetOf(text: string, max: number = IMAP_LIMITS.snippetChars) {
  return text
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith(">"))
    .join(" ")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

type Leaf = { part: string; type: string; charset?: string };
/** The leaves of a body structure that are readable text, plain first. */
export function textParts(node: MessageStructureObject | undefined): Leaf[] {
  const out: Leaf[] = [];
  const walk = (n: MessageStructureObject) => {
    if (n.childNodes?.length) return n.childNodes.forEach(walk);
    const type = n.type.toLowerCase();
    if (
      (type === "text/plain" || type === "text/html") &&
      n.disposition?.toLowerCase() !== "attachment"
    )
      out.push({ part: n.part ?? "1", type, charset: n.parameters?.charset });
  };
  if (node) walk(node);
  return out.sort((a, b) => Number(b.type === "text/plain") - Number(a.type === "text/plain"));
}

/** Whether the structure holds a file a person opens: an attachment disposition, or a named non-text part that is not shown inside the text. */
export function hasFileAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.childNodes?.length) return node.childNodes.some(hasFileAttachment);
  const type = node.type.toLowerCase();
  const name = node.dispositionParameters?.filename ?? node.parameters?.name;
  if (node.disposition?.toLowerCase() === "attachment") return true;
  if (type === "message/rfc822") return true;
  return (
    Boolean(name) &&
    !type.startsWith("text/") &&
    !(node.disposition?.toLowerCase() === "inline" && node.id)
  );
}

// ---- connection pool ---------------------------------------------------------------------------------------------------------------

type Slot = {
  client?: ImapFlow;
  tail: Promise<unknown>;
  pending: number;
  timer?: ReturnType<typeof setTimeout>;
};
const pool = new Map<string, Slot>();
let opened = 0;

/** For tests and the admin: how many connections were opened since start, and how many are open now. */
export const imapPoolStats = () => ({
  opened,
  open: [...pool.values()].filter((s) => s.client?.usable).length,
});

/** Closes every kept connection (shutdown and tests). */
export async function closeImapPool() {
  for (const [k, s] of pool) {
    clearTimeout(s.timer);
    const c = s.client;
    s.client = undefined;
    pool.delete(k);
    if (c) await c.logout().catch(() => c.close());
  }
}

/** Closes the kept connection of one mailbox (its key is the mailbox id), whatever password it was opened with: the mailbox was removed or its settings changed. */
export async function closeImapMailbox(key: string) {
  for (const [k, s] of pool) {
    if (!k.startsWith(`${key}|`)) continue;
    clearTimeout(s.timer);
    const c = s.client;
    s.client = undefined;
    pool.delete(k);
    if (c) await c.logout().catch(() => c.close());
  }
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const timedOut = () =>
  new MailConnectError(
    "TIMEOUT",
    "The mail server took too long to answer.",
    "Try again in a moment.",
  );

type Run = <T>(fn: (c: ImapFlow) => Promise<T>) => Promise<T>;

function runner(
  poolKey: string,
  server: MailServer,
  o: { idleMs: number; operationMs: number },
): Run {
  return async function run<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    await assertMailHosts([server.imapHost]);
    let slot = pool.get(poolKey);
    if (!slot) {
      slot = { tail: Promise.resolve(), pending: 0 };
      pool.set(poolKey, slot);
    }
    const s = slot;
    s.pending++;
    const job = s.tail.then(async () => {
      clearTimeout(s.timer);
      let client = s.client;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drop = () => {
        if (s.client === client) s.client = undefined;
        if (client) {
          const dead = client;
          dead.close();
        }
      };
      try {
        const work = (async () => {
          if (!client?.usable) {
            client = new ImapFlow({
              ...imapOptions(server, { socketTimeout: o.operationMs }),
              disableAutoIdle: true,
            });
            const mine = client;
            mine.on("error", () => {
              if (s.client === mine) s.client = undefined;
            });
            mine.on("close", () => {
              if (s.client === mine) s.client = undefined;
            });
            opened++;
            await mine.connect();
            s.client = mine;
          }
          return fn(client);
        })();
        work.catch(() => undefined);
        const limit = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timedOut()), o.operationMs);
        });
        const out = await Promise.race([work, limit]);
        return out;
      } catch (e) {
        drop();
        throw mailFailure(e, "read the mailbox");
      } finally {
        clearTimeout(timer);
        s.pending--;
        if (s.client?.usable) {
          s.timer = setTimeout(() => {
            const c = s.client;
            s.client = undefined;
            if (!s.pending && pool.get(poolKey) === s) pool.delete(poolKey);
            if (c) void c.logout().catch(() => c.close());
          }, o.idleMs);
          s.timer.unref?.();
        } else if (!s.pending && pool.get(poolKey) === s) pool.delete(poolKey);
      }
    });
    s.tail = job.catch(() => undefined);
    return job;
  };
}

// ---- the driver --------------------------------------------------------------------------------------------------------------------

export type ImapDriverOptions = {
  /** Names the mailbox in the connection pool (its id). */
  key: string;
  /** The mailbox's own address: what the messages it sends come from. */
  address: string;
  /** The settings plus the password (read by the caller, never here). */
  server: MailServer;
  idleMs?: number;
  operationMs?: number;
};

type Header = ThreadMessage & {
  uid: number;
  time: number;
  internal: number;
  from: MailAddress[];
  to: MailAddress[];
  structure?: MessageStructureObject;
};

const addr = (list: { name?: string; address?: string }[] | undefined): MailAddress[] =>
  (list ?? [])
    .filter((a) => a.address)
    .map((a) => ({ name: (a.name ?? "").trim(), address: (a.address ?? "").trim().toLowerCase() }));

const clean = (s: string | undefined, max: number) => oneLine(s, max);

/** None of these may appear in a header value. */
const hasLineBreak = (s: string) => Array.from(s).some(isControl);
const ADDRESS = /^[^\s<>@,;"()\\]+@[^\s<>@,;"()\\]+$/;
const bad = (what: string) =>
  new MailConnectError("BAD_INPUT", `The ${what} is not valid.`, "Check it and try again.");

/** The inputs of `send` that could smuggle a header (or a second recipient) into the message are refused, not cleaned. */
export function checkOutgoing(m: OutgoingMail, own: string) {
  if (!ADDRESS.test(own)) throw bad("sender address");
  if (!Array.isArray(m.to) || m.to.length < 1 || m.to.length > IMAP_LIMITS.recipients)
    throw bad("recipient list");
  for (const t of m.to)
    if (typeof t !== "string" || t.length > 320 || !ADDRESS.test(t)) throw bad("recipient address");
  if (
    typeof m.subject !== "string" ||
    hasLineBreak(m.subject) ||
    m.subject.length > IMAP_LIMITS.subject
  )
    throw bad("subject");
  if (
    typeof m.text !== "string" ||
    m.text.length > IMAP_LIMITS.bodyChars ||
    m.text.includes("\u0000")
  )
    throw bad("text");
  if (m.inReplyTo !== undefined && typeof m.inReplyTo !== "string") throw bad("message to answer");
}

export function createImapDriver(o: ImapDriverOptions): MailboxDriver {
  const server = o.server;
  const run = runner(`${o.key}|${hash(server.password)}`, server, {
    idleMs: o.idleMs ?? IMAP_LIMITS.idleMs,
    operationMs: o.operationMs ?? IMAP_LIMITS.operationMs,
  });

  const validity = (c: ImapFlow) =>
    String(c.mailbox && typeof c.mailbox === "object" ? c.mailbox.uidValidity : "0");

  /** Runs `fn` with the folder open read-only; the lock is released after. */
  async function inFolder<T>(c: ImapFlow, path: string, fn: () => Promise<T>) {
    const lock = await c.getMailboxLock(path, { readOnly: true });
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }

  async function sentFolder(c: ImapFlow) {
    return findSentFolder(await c.list());
  }

  async function fetchHeaders(c: ImapFlow, uids: number[]): Promise<Header[]> {
    const out: Header[] = [];
    if (!uids.length) return out;
    for await (const m of c.fetch(
      uidSet(uids),
      {
        uid: true,
        envelope: true,
        internalDate: true,
        bodyStructure: true,
        headers: ["message-id", "in-reply-to", "references"],
      },
      { uid: true },
    )) {
      const h = parseThreadHeaders(m.headers);
      const env = m.envelope;
      const internal = m.internalDate ? new Date(m.internalDate).getTime() : 0;
      const dated = env?.date ? new Date(env.date).getTime() : NaN;
      out.push({
        key: `i:${m.uid}`,
        uid: m.uid,
        messageId: h.messageId || parseMessageIds(env?.messageId)[0] || "",
        inReplyTo: h.inReplyTo.length ? h.inReplyTo : parseMessageIds(env?.inReplyTo),
        references: h.references,
        subject: clean(env?.subject, IMAP_LIMITS.subject),
        time: Number.isFinite(dated) ? dated : internal,
        internal,
        from: addr(env?.from),
        to: addr(env?.to),
        structure: m.bodyStructure,
      });
    }
    return out;
  }

  async function snippetFor(c: ImapFlow, h: Header): Promise<string> {
    const leaf = textParts(h.structure)[0];
    if (!leaf) return "";
    try {
      const dl = await c.download(String(h.uid), leaf.part, {
        uid: true,
        maxBytes: IMAP_LIMITS.snippetBytes,
      });
      if (!dl?.content) return "";
      const chunks: Buffer[] = [];
      for await (const chunk of dl.content) chunks.push(Buffer.from(chunk));
      let text: string;
      try {
        text = new TextDecoder((leaf.charset || "utf-8") as "utf-8").decode(Buffer.concat(chunks));
      } catch {
        text = Buffer.concat(chunks).toString("utf8");
      }
      return snippetOf(text);
    } catch {
      return "";
    }
  }

  async function listConversations(q: ListQuery): Promise<ConversationPage> {
    const limit = Math.max(1, Math.min(IMAP_LIMITS.maxPage, Math.floor(q.limit) || 1));
    const query = clean(q.query, IMAP_LIMITS.queryChars);
    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    if (cursor && cursor.q !== query) throw badToken("page");
    return run((c) =>
      inFolder(c, "INBOX", async () => {
        const vl = validity(c);
        if (cursor && cursor.vl !== vl) throw badToken("page");
        const found = await c.search(query ? { text: query } : { all: true }, { uid: true });
        const uids = (found || []).slice().sort((a, b) => a - b);
        // The newest messages below the cursor, plus the nearest ones above it (only to tell which conversations an earlier page showed).
        const below = cursor ? uids.filter((u) => u < cursor.b) : uids;
        const above = cursor ? uids.filter((u) => u >= cursor.b).slice(0, IMAP_LIMITS.scan) : [];
        const window = below.slice(-IMAP_LIMITS.scan);
        const headers = await fetchHeaders(c, [...window, ...above]);
        const groups = groupConversations(headers)
          .map((g) => ({ g, newest: Math.max(...g.map((m) => m.uid)) }))
          .filter((x) => !cursor || x.newest < cursor.b)
          .sort((a, b) => b.newest - a.newest);
        const shown = groups.slice(0, limit);
        const conversations: ConversationSummary[] = [];
        for (const { g, newest } of shown) {
          const latest = g.find((m) => m.uid === newest)!;
          const people = new Map<string, MailAddress>();
          for (const m of [...g].reverse())
            for (const p of [...m.from, ...m.to])
              if (!people.has(p.address)) people.set(p.address, p);
          const lastTime = Math.max(...g.map((m) => m.time || m.internal));
          conversations.push({
            id: encodeToken({
              v: 1,
              k: "c",
              vl,
              u: g.map((m) => m.uid).slice(-IMAP_LIMITS.conversationMessages),
            }),
            subject: baseSubject(g[0]!.subject),
            participants: [...people.values()].slice(0, 6),
            lastDate: new Date(lastTime || 0).toISOString(),
            messageCount: g.length,
            snippet: await snippetFor(c, latest),
            attachments: g.some((m) => hasFileAttachment(m.structure)) ? "some" : "none",
          });
        }
        return {
          conversations,
          ...(groups.length > shown.length
            ? {
                nextCursor: encodeToken({
                  v: 1,
                  k: "p",
                  vl,
                  b: shown[shown.length - 1]!.newest,
                  q: query,
                }),
              }
            : {}),
        };
      }),
    );
  }

  /** The sources of some messages of the open folder, parsed one at a time (never all in memory at once). */
  async function readMessages(
    c: ImapFlow,
    uids: number[],
    origin: MessageOrigin,
    folder: string,
    vl: string,
  ) {
    const out: {
      uid: number;
      message: MailMessage;
      head: ReturnType<typeof parseThreadHeaders>;
    }[] = [];
    if (!uids.length) return out;
    for await (const m of c.fetch(
      uidSet(uids),
      { uid: true, size: true, source: { maxLength: IMAP_LIMITS.messageBytes } },
      { uid: true },
    )) {
      const src = m.source;
      if (!src) continue;
      const id = encodeToken({ v: 1, k: "m", vl, o: origin, f: folder, u: m.uid });
      const message = await parseMessage(src, {
        id,
        origin,
        truncated: (m.size ?? 0) > src.length,
      });
      out.push({ uid: m.uid, message, head: parseThreadHeaders(src.subarray(0, 200_000)) });
    }
    return out;
  }

  const idsQuery = (ids: string[], fields: string[]) => {
    const terms = ids.flatMap((id) => fields.map((f) => ({ header: { [f]: id } })));
    return terms.length === 1 ? terms[0]! : { or: terms };
  };

  async function getConversation(id: string): Promise<Conversation> {
    const token = decodeConversation(id);
    return run(async (c) => {
      type Item = {
        key: string;
        message: MailMessage;
        head: ReturnType<typeof parseThreadHeaders>;
      };
      const items: Item[] = [];
      const seen = new Set<number>();
      const add = (
        rows: Awaited<ReturnType<typeof readMessages>>,
        origin: MessageOrigin,
        folder: string,
      ) => {
        for (const r of rows) {
          const key = `${origin}:${folder}:${r.uid}`;
          if (origin === "received") seen.add(r.uid);
          items.push({ key, message: r.message, head: r.head });
        }
      };

      await inFolder(c, "INBOX", async () => {
        const vl = validity(c);
        if (vl !== token.vl) throw badToken("conversation");
        add(await readMessages(c, token.u, "received", "INBOX", vl), "received", "INBOX");
        if (!items.length)
          throw new MailConnectError("NOT_FOUND", "That conversation is no longer in the mailbox.");
        const askedIds = new Set<string>();
        const askedChildren = new Set<string>();
        for (
          let round = 0;
          round < IMAP_LIMITS.expandRounds && seen.size < IMAP_LIMITS.conversationMessages;
          round++
        ) {
          const known = new Set(items.map((i) => i.head.messageId).filter(Boolean));
          const mentioned = new Set(
            items.flatMap((i) => [...i.head.references, ...i.head.inReplyTo]),
          );
          const parents = [...mentioned]
            .filter((x) => !known.has(x) && !askedIds.has(x))
            .slice(0, IMAP_LIMITS.idsPerSearch);
          const children = [...known]
            .filter((x) => !askedChildren.has(x))
            .slice(0, IMAP_LIMITS.idsPerSearch);
          parents.forEach((x) => askedIds.add(x));
          children.forEach((x) => askedChildren.add(x));
          const hits = new Set<number>();
          if (parents.length)
            for (const u of (await c.search(idsQuery(parents, ["message-id"]), { uid: true })) ||
              [])
              hits.add(u);
          if (children.length)
            for (const u of (await c.search(idsQuery(children, ["references", "in-reply-to"]), {
              uid: true,
            })) || [])
              hits.add(u);
          const fresh = [...hits]
            .filter((u) => !seen.has(u))
            .slice(0, IMAP_LIMITS.conversationMessages - seen.size);
          if (!fresh.length) break;
          add(await readMessages(c, fresh, "received", "INBOX", vl), "received", "INBOX");
        }
      });

      // The person's own replies, by the ids of everything that was received.
      const sent = await sentFolder(c);
      if (sent) {
        await inFolder(c, sent, async () => {
          const ids = [...new Set(items.map((i) => i.head.messageId).filter(Boolean))].slice(
            -IMAP_LIMITS.idsPerSearch,
          );
          if (!ids.length) return;
          const hits = (
            (await c.search(idsQuery(ids, ["references", "in-reply-to"]), { uid: true })) || []
          )
            .sort((a, b) => a - b)
            .slice(-(IMAP_LIMITS.conversationMessages - items.length));
          add(await readMessages(c, hits, "sent", sent, validity(c)), "sent", sent);
        });
      }

      const thread = items.map((i) => ({
        key: i.key,
        messageId: i.head.messageId || i.message.messageId,
        inReplyTo: i.head.inReplyTo,
        references: i.head.references,
        subject: i.message.subject,
        time: i.message.date ? Date.parse(i.message.date) : 0,
        item: i,
      }));
      const anchor = `received:INBOX:${token.u[0]}`;
      const group = groupConversations(thread).find((g) => g.some((m) => m.key === anchor)) ?? [];
      const messages = group.map((m) => m.item.message);
      return { id, subject: baseSubject(messages[0]?.subject ?? ""), messages };
    });
  }

  /** The message and the file index an attachment id names; a malformed id is a bad token. */
  function splitAttachmentId(attachmentId: string) {
    const dot = attachmentId.lastIndexOf(".");
    const index = Number(attachmentId.slice(dot + 1));
    if (dot < 1 || !Number.isInteger(index) || index < 0) throw badToken("attachment");
    return {
      message: attachmentId.slice(0, dot),
      msg: decodeMessage(attachmentId.slice(0, dot)),
      index,
    };
  }

  /** Runs `fn` with the folder of the message open; the id of a message that is gone or moved is a bad token. */
  async function inMessageFolder<T>(
    c: ImapFlow,
    msg: ReturnType<typeof decodeMessage>,
    fn: () => Promise<T>,
  ) {
    const folder = msg.o === "received" ? "INBOX" : await sentFolder(c);
    if (!folder || (msg.o === "sent" && folder !== msg.f)) throw badToken("attachment");
    return inFolder(c, folder, async () => {
      if (validity(c) !== msg.vl) throw badToken("attachment");
      return fn();
    });
  }

  /** The source of one message of the open folder, read for its files; undefined when the message is gone, and too large is an error. */
  async function sourceForFiles(c: ImapFlow, uid: number) {
    const size = await c.fetchOne(String(uid), { size: true }, { uid: true });
    if (!size) throw new MailConnectError("NOT_FOUND", "That message is no longer in the mailbox.");
    if ((size.size ?? 0) > ATTACHMENT_SOURCE) throw tooLarge();
    const m = await c.fetchOne(
      String(uid),
      { source: { maxLength: ATTACHMENT_SOURCE } },
      { uid: true },
    );
    if (!m || !m.source)
      throw new MailConnectError("NOT_FOUND", "That message is no longer in the mailbox.");
    return m.source;
  }

  async function getAttachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<AttachmentBytes> {
    decodeConversation(conversationId);
    const { msg, index } = splitAttachmentId(attachmentId);
    return run((c) =>
      inMessageFolder(c, msg, async () => {
        const file = await extractAttachment(await sourceForFiles(c, msg.u), index);
        if (!file) throw new MailConnectError("NOT_FOUND", "That file is not in the message.");
        if (file.bytes.length > IMAP_LIMITS.attachmentBytes) throw tooLarge();
        return file;
      }),
    );
  }

  /** Several files at once: the source of each message is read and parsed once for all of its files. A file that is missing or too large is left out. */
  async function getAttachments(
    conversationId: string,
    attachmentIds: string[],
  ): Promise<Map<string, AttachmentBytes>> {
    decodeConversation(conversationId);
    const groups = new Map<
      string,
      { msg: ReturnType<typeof decodeMessage>; files: { id: string; index: number }[] }
    >();
    for (const id of attachmentIds) {
      const { message, msg, index } = splitAttachmentId(id);
      const g = groups.get(message) ?? { msg, files: [] };
      g.files.push({ id, index });
      groups.set(message, g);
    }
    const out = new Map<string, AttachmentBytes>();
    if (!groups.size) return out;
    return run(async (c) => {
      for (const { msg, files } of groups.values())
        await inMessageFolder(c, msg, async () => {
          let source: Uint8Array;
          try {
            source = await sourceForFiles(c, msg.u);
          } catch (e) {
            if (e instanceof MailConnectError) return; // gone or too large: its files are left out
            throw e;
          }
          const found = await extractAttachments(
            source,
            files.map((f) => f.index),
          );
          for (const f of files) {
            const file = found.get(f.index);
            if (file && file.bytes.length <= IMAP_LIMITS.attachmentBytes) out.set(f.id, file);
          }
        });
      return out;
    });
  }

  const tooLarge = () =>
    new MailConnectError(
      "TOO_LARGE",
      `That file is larger than ${IMAP_LIMITS.attachmentBytes / 1_000_000} MB, so it is not downloaded here.`,
    );

  async function check() {
    await assertMailHosts([server.imapHost, server.smtpHost]);
    await run(async (c) => {
      await c.noop();
    }).catch((e) => {
      throw mailFailure(e, "sign in");
    });
    const t = nodemailer.createTransport(
      smtpOptions(server, {
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        locked: true,
      }),
    );
    try {
      await t.verify();
    } catch (e) {
      throw mailFailure(e, "sign in");
    } finally {
      t.close();
    }
  }

  async function send(mail: OutgoingMail): Promise<SentMail> {
    checkOutgoing(mail, o.address);
    const ref = mail.inReplyTo ? decodeMessage(mail.inReplyTo) : undefined;
    await assertMailHosts([server.smtpHost, server.imapHost]);
    let threading: { inReplyTo?: string; references?: string[] } = {};
    if (ref) {
      const head = await run(async (c) => {
        const folder = ref.o === "received" ? "INBOX" : await sentFolder(c);
        if (!folder || (ref.o === "sent" && folder !== ref.f)) throw badToken("message");
        return inFolder(c, folder, async () => {
          if (validity(c) !== ref.vl) throw badToken("message");
          const m = await c.fetchOne(
            String(ref.u),
            { headers: ["message-id", "in-reply-to", "references"] },
            { uid: true },
          );
          if (!m)
            throw new MailConnectError(
              "NOT_FOUND",
              "The message to answer is no longer in the mailbox.",
            );
          return parseThreadHeaders((m as FetchMessageObject).headers);
        });
      });
      if (!head.messageId)
        throw new MailConnectError(
          "NO_MESSAGE_ID",
          "The message to answer has no identifier, so a reply cannot be linked to it.",
        );
      threading = {
        inReplyTo: `<${head.messageId}>`,
        references: [...head.references, head.messageId].slice(-20).map((id) => `<${id}>`),
      };
    }
    const t = nodemailer.createTransport(
      smtpOptions(server, {
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        locked: true,
      }),
    );
    // The message is built once: the bytes the server takes are the bytes filed in the sent folder.
    const messageId = `<${uuidv7()}@${o.address.split("@")[1] ?? "localhost"}>`;
    let raw: Buffer;
    try {
      raw = await new MailComposer({
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
      await t.sendMail({ envelope: { from: o.address, to: mail.to }, raw });
    } catch (e) {
      throw mailFailure(e, "send the message");
    } finally {
      t.close();
    }
    return { messageId: messageId.replace(/^<|>$/g, ""), copy: await fileCopy(raw) };
  }

  /** Puts the sent bytes in the sent folder. Anything that goes wrong leaves the send as it is: the result only says "not_saved". */
  async function fileCopy(raw: Buffer): Promise<SentCopy> {
    try {
      return await run(async (c): Promise<SentCopy> => {
        const folder = await sentFolder(c);
        if (!folder) return "not_saved";
        await c.append(folder, raw, ["\\Seen"], new Date());
        return "saved";
      });
    } catch {
      return "not_saved";
    }
  }

  return { check, listConversations, getConversation, getAttachment, getAttachments, send };
}

/**
 * What a mailbox must be able to do, whatever sits behind it. `imap` is the first implementation (`drivers/imap.ts`); a Gmail one and a
 * provisioned address come later and must fit these types, so no provider word appears here. Every failure is a `MailConnectError` from
 * `imap-connect.ts`: a stable `code` and a sentence the person can read, never the server's own words.
 *
 * The mailbox is read and never changed: nothing is marked as read, flagged, moved or deleted by any call below. The one write is the
 * copy of a message the mailbox just sent, put in its sent folder as part of `send` (a provider that files the copy by itself does
 * nothing there).
 */
import type { MailConnectError } from "./imap-connect";

export type MailAddress = { name: string; address: string };

/** Whether a conversation, or a message, carries files a person would call attachments (an image shown inside the text is not one). */
export type AttachmentPresence = "none" | "some";

export type ConversationSummary = {
  /** Opaque: only `getConversation` reads it. */
  id: string;
  subject: string;
  /** The people in it, the most recent speakers first. The mailbox's own address is included; the service takes it out (`othersOf`) so every driver reads the same. */
  participants: MailAddress[];
  /** ISO time of the newest message. */
  lastDate: string;
  messageCount: number;
  /** The first words of the newest message, plain text. */
  snippet: string;
  attachments: AttachmentPresence;
};

export type ConversationPage = {
  conversations: ConversationSummary[];
  /** Opaque; pass it back as `cursor` for the next page. Absent when there is no older conversation. */
  nextCursor?: string;
};

export type ListQuery = {
  /** Words to find; the server runs the search. */
  query?: string;
  cursor?: string;
  limit: number;
};

/** `inline`: shown inside the message body (an image the HTML points to). `attachment`: a file for the person to open. */
export type AttachmentDisposition = "attachment" | "inline";

export type AttachmentInfo = {
  /** Opaque: only `getAttachment` reads it. */
  id: string;
  fileName: string;
  contentType: string;
  /** Bytes, as decoded. */
  size: number;
  disposition: AttachmentDisposition;
  /** The `cid:` an inline part is referred to by; the sanitiser step maps it. Empty when it has none. */
  contentId: string;
};

/** `received`: it is in the mailbox's inbox. `sent`: it is the person's own reply, found in the sent folder. */
export type MessageOrigin = "received" | "sent";
/** `complete`: the whole source was read. `truncated`: it was longer than the limit, so text and file list may be cut. `unreadable`: it could not be parsed. */
export type MessageSource = "complete" | "truncated" | "unreadable";

export type MailMessage = {
  /** Opaque: pass it as `inReplyTo` to `send` to answer this message. */
  id: string;
  /** The Message-ID header, without the angle brackets; empty when the message has none. */
  messageId: string;
  origin: MessageOrigin;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  /** The Reply-To header: where the sender asked for answers to go. Empty when there is none. */
  replyTo: MailAddress[];
  /** ISO time, or null when the message has no usable date. */
  date: string | null;
  subject: string;
  text: string;
  /**
   * The HTML part exactly as the sender wrote it. UNSAFE: scripts, tracking pixels, remote content and forged links are all still in it.
   * Nothing may render this field before the sanitiser step has cleaned it.
   */
  htmlUnsafe: string;
  attachments: AttachmentInfo[];
  source: MessageSource;
};

export type Conversation = {
  id: string;
  subject: string;
  /** Oldest first. */
  messages: MailMessage[];
};

export type AttachmentBytes = {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
};

/** What `send` takes. There is no field for a header: the server writes the threading headers itself. */
export type OutgoingMail = {
  /** Plain addresses only (`ana@example.com`), no display names. */
  to: string[];
  subject: string;
  text: string;
  /** The `id` of the message being answered (from `getConversation`); the server reads that message and sets In-Reply-To and References. */
  inReplyTo?: string;
};

/**
 * `saved`: the sent message was put in the mailbox's sent folder. `provider`: the provider files its own copy (nothing to do).
 * `not_saved`: the message went out but no copy could be put in the sent folder (none exists, or the append failed).
 */
export type SentCopy = "saved" | "provider" | "not_saved";
export type SentMail = { messageId: string; copy: SentCopy };

export interface MailboxDriver {
  /** Proves the settings work: signs in to the reading and the sending server. */
  check(): Promise<void>;
  listConversations(q: ListQuery): Promise<ConversationPage>;
  getConversation(id: string): Promise<Conversation>;
  /** The file's bytes; refused over the size cap. */
  getAttachment(conversationId: string, attachmentId: string): Promise<AttachmentBytes>;
  /**
   * Several files of one conversation, keyed by attachment id. The source of each message is read once for all of its files listed here.
   * A file that is missing, or over the size cap, is left out of the result instead of failing the others.
   */
  getAttachments(
    conversationId: string,
    attachmentIds: string[],
  ): Promise<Map<string, AttachmentBytes>>;
  send(mail: OutgoingMail): Promise<SentMail>;
}

export type { MailConnectError };

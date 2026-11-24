import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation } from "./chat";
import { connection } from "./connections";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

/**
 * `imap`: any IMAP and SMTP server, the password sealed in the connections store. `google`: Gmail through the person's Google connection.
 * `microsoft`: Outlook.com and Microsoft 365 through the person's Microsoft connection (Microsoft Graph). `provisioned`: an address the
 * installation hands to a bot.
 */
export const MAILBOX_KINDS = ["imap", "google", "microsoft", "provisioned"] as const;
export type MailboxKind = (typeof MAILBOX_KINDS)[number];
/** `needs_auth`: the server refused the credentials and the person must sign in again. `error`: it cannot be read for another reason. */
export const MAILBOX_STATES = ["active", "needs_auth", "error", "retired"] as const;
export type MailboxState = (typeof MAILBOX_STATES)[number];
/** Whether the mailbox may send mail. */
export const MAILBOX_SENDING = ["on", "off"] as const;
export type MailboxSending = (typeof MAILBOX_SENDING)[number];

/**
 * What a driver needs to reach the server, never a secret: the password is the sealed `connection` row. `imap` fills the host, port and
 * security of both servers and the user name; the other kinds leave it empty.
 */
export type MailboxConfig = {
  imapHost?: string;
  imapPort?: number;
  imapSecurity?: "tls" | "starttls";
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: "tls" | "starttls";
  user?: string;
};

/**
 * One connected mailbox: the person's own address, read-only in Zetta, optionally owned by one bot. It is not a plugin install (a plugin
 * installs once per person); a person may connect many. `lastError` is a sentence written by the server, never a mail server's answer.
 * Archiving a bot keeps its row, so the app decides what an archived owner means; hard-deleting the bot row only sets `bot_id` to null.
 * Deleting the person is refused while they own a mailbox.
 */
export const mailbox = zetta.table(
  "mailbox",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    /** The bot that owns the mailbox (it reads and answers for it), or null when only the person does. */
    botId: uuid("bot_id").references(() => bot.id, setNull),
    kind: text("kind", { enum: MAILBOX_KINDS }).notNull(),
    /** The e-mail address, stored trimmed and compared case-insensitively. */
    address: text("address").notNull(),
    label: text("label").default("").notNull(),
    state: text("state", { enum: MAILBOX_STATES }).default("active").notNull(),
    lastError: text("last_error"),
    sending: text("sending", { enum: MAILBOX_SENDING }).default("on").notNull(),
    /** The sealed secret (the IMAP password) in the connections store. */
    connectionId: uuid("connection_id").references(() => connection.id, setNull),
    config: jsonb("config").$type<MailboxConfig>().default({}).notNull(),
    /** Addresses or domains (`ana@example.com`, `@example.com`) allowed to write to the owner bot. */
    allowedSenders: jsonb("allowed_senders").$type<string[]>().default([]).notNull(),
    /** The chat where the owner bot talks about this mailbox; cleared when the owner bot changes. */
    chatConversationId: uuid("chat_conversation_id").references(() => conversation.id, setNull),
    /**
     * Set when the person removed a provisioned mailbox: its mail is purged and it is hidden, but the row stays so the address is
     * never handed out again. Null for every mailbox that is shown.
     */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("mailbox_owner_kind_address_unique").on(
      t.ownerUserId,
      t.kind,
      sql`lower(${t.address})`,
    ),
    // An address the installation hands out belongs to one person only.
    uniqueIndex("mailbox_provisioned_address_unique")
      .on(sql`lower(${t.address})`)
      .where(sql`${t.kind} = 'provisioned'`),
    index("mailbox_bot_id_idx").on(t.botId),
    check("mailbox_kind_check", sql`${t.kind} in ('imap', 'google', 'microsoft', 'provisioned')`),
    check("mailbox_state_check", sql`${t.state} in ('active', 'needs_auth', 'error', 'retired')`),
    check("mailbox_sending_check", sql`${t.sending} in ('on', 'off')`),
    check("mailbox_address_check", sql`length(btrim(${t.address})) between 3 and 320`),
    check("mailbox_label_check", sql`length(${t.label}) <= 120`),
    check("mailbox_last_error_check", sql`${t.lastError} is null or length(${t.lastError}) <= 500`),
    check("mailbox_allowed_senders_check", sql`jsonb_typeof(${t.allowedSenders}) = 'array'`),
    check("mailbox_config_check", sql`jsonb_typeof(${t.config}) = 'object'`),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** The most a stored message source may hold (about 15 MB); a longer one is not stored and its text is cut. */
export const MAILBOX_MESSAGE_RAW_MAX = 15 * 1024 * 1024;
export const MAILBOX_MESSAGE_DIRECTIONS = ["in", "out"] as const;
export type MailboxMessageDirection = (typeof MAILBOX_MESSAGE_DIRECTIONS)[number];
export const MAILBOX_MESSAGE_ATTACHMENTS = ["none", "some"] as const;

/**
 * One message of a provisioned mailbox, kept here because the provider keeps received mail only for a while (its plan decides).
 * `in`: received through the provider; `out`: the copy of what the mailbox sent. `providerRef` is the provider's own id of a received
 * message (a generated one for a sent copy) so a replayed poll never stores twice. Removing the mailbox purges these rows.
 */
export const mailboxMessage = zetta.table(
  "mailbox_message",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailbox.id, restrict),
    providerRef: text("provider_ref").notNull(),
    direction: text("direction", { enum: MAILBOX_MESSAGE_DIRECTIONS }).notNull(),
    /** The Message-ID header, without angle brackets; empty when the message has none. */
    messageId: text("message_id").default("").notNull(),
    inReplyTo: text("in_reply_to").default("").notNull(),
    references: jsonb("references").$type<string[]>().default([]).notNull(),
    /** Messages of one conversation share it (an id made when the first one arrived). */
    threadKey: text("thread_key").notNull(),
    fromAddress: text("from_address").default("").notNull(),
    fromName: text("from_name").default("").notNull(),
    toAddresses: jsonb("to_addresses").$type<string[]>().default([]).notNull(),
    subject: text("subject").default("").notNull(),
    date: timestamp("date", { withTimezone: true }).defaultNow().notNull(),
    textBody: text("text_body").default("").notNull(),
    /** What the provider says of the sender: `{ spf, dkim, dmarc }`, each `pass`, `fail` and so on; empty for a sent copy. */
    authentication: jsonb("authentication").$type<Record<string, string>>().default({}).notNull(),
    attachments: text("attachments", { enum: MAILBOX_MESSAGE_ATTACHMENTS })
      .default("none")
      .notNull(),
    rawMime: bytea("raw_mime"),
    size: integer("size").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("mailbox_message_provider_ref_unique").on(t.mailboxId, t.providerRef),
    index("mailbox_message_thread_idx").on(t.mailboxId, t.threadKey, t.date),
    index("mailbox_message_id_idx").on(t.mailboxId, t.messageId),
    check("mailbox_message_direction_check", sql`${t.direction} in ('in', 'out')`),
    check("mailbox_message_attachments_check", sql`${t.attachments} in ('none', 'some')`),
    check(
      "mailbox_message_raw_check",
      sql`${t.rawMime} is null or length(${t.rawMime}) <= ${sql.raw(String(MAILBOX_MESSAGE_RAW_MAX))}`,
    ),
    check("mailbox_message_refs_check", sql`jsonb_typeof(${t.references}) = 'array'`),
    check("mailbox_message_to_check", sql`jsonb_typeof(${t.toAddresses}) = 'array'`),
  ],
);

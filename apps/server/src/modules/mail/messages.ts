/**
 * The messages of provisioned mailboxes, kept in Postgres (`zetta.mailbox_message`) because the provider keeps received mail only for a
 * while. Nothing here talks to a provider: the poller puts received mail in, the driver puts the copy of a sent mail in, and removing a
 * mailbox purges everything it holds.
 */
import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, desc, eq, getTableColumns, gt, inArray, sql } from "@zetta/db/query";
import { mailboxMessage, type MailboxMessageDirection } from "@zetta/db/schema/mail";
import { isReplySubject, normalizeSubject, THREAD_FALLBACK_DAYS } from "./threading";

export type StoredMessage = typeof mailboxMessage.$inferSelect;
/** A message without its source: what a list needs. */
export type StoredMessageHead = Omit<StoredMessage, "rawMime">;

export type NewMessage = {
  mailboxId: string;
  providerRef: string;
  direction: MailboxMessageDirection;
  messageId: string;
  inReplyTo: string;
  references: string[];
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  subject: string;
  date: Date;
  textBody: string;
  authentication: Record<string, string>;
  attachments: "none" | "some";
  raw: Uint8Array;
};

const { rawMime: _source, ...head } = getTableColumns(mailboxMessage);

/** `%` and `_` in the words of a search mean themselves. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export type ThreadCursor = { d: string; k: string };

export function createMessageStore(db: Database) {
  const mine = (mailboxId: string) => eq(mailboxMessage.mailboxId, mailboxId);

  /** The conversation a new message belongs to: by the ids it names, by the ids that name it, by a "Re:" subject; else a new one. */
  async function threadKeyFor(
    mailboxId: string,
    m: { messageId: string; inReplyTo: string; references: string[]; subject: string },
  ): Promise<string> {
    const ids = [
      ...new Set([m.inReplyTo, ...m.references].map((x) => x.toLowerCase()).filter(Boolean)),
    ];
    if (ids.length) {
      const [hit] = await db
        .select({ key: mailboxMessage.threadKey })
        .from(mailboxMessage)
        .where(and(mine(mailboxId), inArray(sql`lower(${mailboxMessage.messageId})`, ids)))
        .orderBy(mailboxMessage.date)
        .limit(1);
      if (hit) return hit.key;
    }
    if (m.messageId) {
      const id = m.messageId.toLowerCase();
      const [hit] = await db
        .select({ key: mailboxMessage.threadKey })
        .from(mailboxMessage)
        .where(
          and(
            mine(mailboxId),
            sql`(lower(${mailboxMessage.inReplyTo}) = ${id} or ${mailboxMessage.references} @> ${JSON.stringify([id])}::jsonb)`,
          ),
        )
        .limit(1);
      if (hit) return hit.key;
    }
    if (isReplySubject(m.subject) && !m.inReplyTo && m.references.length === 0) {
      const wanted = normalizeSubject(m.subject);
      const since = new Date(Date.now() - THREAD_FALLBACK_DAYS * 86_400_000);
      const near = await db
        .select({ key: mailboxMessage.threadKey, subject: mailboxMessage.subject })
        .from(mailboxMessage)
        .where(and(mine(mailboxId), gt(mailboxMessage.date, since)))
        .orderBy(desc(mailboxMessage.date))
        .limit(200);
      const hit = near.find((r) => wanted && normalizeSubject(r.subject) === wanted);
      if (hit) return hit.key;
    }
    return uuidv7();
  }

  return {
    threadKeyFor,

    /** Stores one message; undefined when this provider reference is already stored (a replayed poll). */
    async insert(m: NewMessage): Promise<StoredMessageHead | undefined> {
      const threadKey = await threadKeyFor(m.mailboxId, m);
      const [row] = await db
        .insert(mailboxMessage)
        .values({
          mailboxId: m.mailboxId,
          providerRef: m.providerRef,
          direction: m.direction,
          messageId: m.messageId,
          inReplyTo: m.inReplyTo,
          references: m.references,
          threadKey,
          fromAddress: m.fromAddress,
          fromName: m.fromName,
          toAddresses: m.toAddresses,
          subject: m.subject,
          date: m.date,
          textBody: m.textBody,
          authentication: m.authentication,
          attachments: m.attachments,
          rawMime: Buffer.from(m.raw),
          size: m.raw.length,
        })
        .onConflictDoNothing()
        .returning(head);
      return row;
    },

    async has(mailboxId: string, providerRef: string) {
      const [row] = await db
        .select({ id: mailboxMessage.id })
        .from(mailboxMessage)
        .where(and(mine(mailboxId), eq(mailboxMessage.providerRef, providerRef)));
      return Boolean(row);
    },

    /** One page of conversations, the newest first: each as the keys, the newest date and the count. `query` runs as ILIKE. */
    async threadPage(
      mailboxId: string,
      o: { query?: string; cursor?: ThreadCursor; limit: number },
    ) {
      const like = o.query ? likePattern(o.query) : undefined;
      const match = like
        ? sql`and (${mailboxMessage.subject} ilike ${like} escape '\\' or ${mailboxMessage.fromAddress} ilike ${like} escape '\\' or ${mailboxMessage.fromName} ilike ${like} escape '\\' or ${mailboxMessage.textBody} ilike ${like} escape '\\')`
        : sql``;
      const after = o.cursor
        ? sql`having (max(${mailboxMessage.date}), ${mailboxMessage.threadKey}) < (${o.cursor.d}::timestamptz, ${o.cursor.k})`
        : sql``;
      const res = await db.execute<{ key: string; last: Date | string }>(sql`
        select ${mailboxMessage.threadKey} as key, max(${mailboxMessage.date}) as last
        from ${mailboxMessage}
        where ${mailboxMessage.mailboxId} = ${mailboxId} ${match}
        group by ${mailboxMessage.threadKey} ${after}
        order by max(${mailboxMessage.date}) desc, ${mailboxMessage.threadKey} desc
        limit ${o.limit + 1}`);
      const rows = ((res as unknown as { rows?: unknown[] }).rows ??
        (res as unknown as unknown[])) as {
        key: string;
        last: Date | string;
      }[];
      return {
        threads: rows.slice(0, o.limit).map((r) => ({ key: r.key, last: new Date(r.last) })),
        more: rows.length > o.limit,
      };
    },

    /** The messages (without their source) of several conversations, oldest first. */
    heads(mailboxId: string, keys: string[]): Promise<StoredMessageHead[]> {
      if (!keys.length) return Promise.resolve([]);
      return db
        .select(head)
        .from(mailboxMessage)
        .where(and(mine(mailboxId), inArray(mailboxMessage.threadKey, keys)))
        .orderBy(mailboxMessage.date, mailboxMessage.id);
    },

    /** One conversation with its sources, oldest first. */
    async thread(mailboxId: string, key: string): Promise<StoredMessage[]> {
      return db
        .select()
        .from(mailboxMessage)
        .where(and(mine(mailboxId), eq(mailboxMessage.threadKey, key)))
        .orderBy(mailboxMessage.date, mailboxMessage.id)
        .limit(200);
    },

    async get(mailboxId: string, id: string): Promise<StoredMessage | undefined> {
      const [row] = await db
        .select()
        .from(mailboxMessage)
        .where(and(mine(mailboxId), eq(mailboxMessage.id, id)));
      return row;
    },

    /** The newest message received from an address, or undefined. */
    async latestFrom(mailboxId: string, address: string): Promise<StoredMessageHead | undefined> {
      const [row] = await db
        .select(head)
        .from(mailboxMessage)
        .where(
          and(
            mine(mailboxId),
            eq(mailboxMessage.direction, "in"),
            eq(sql`lower(${mailboxMessage.fromAddress})`, address.toLowerCase()),
          ),
        )
        .orderBy(desc(mailboxMessage.date))
        .limit(1);
      return row;
    },

    async count(mailboxId: string) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(mailboxMessage)
        .where(mine(mailboxId));
      return Number(row?.n ?? 0);
    },
  };
}
export type MessageStore = ReturnType<typeof createMessageStore>;

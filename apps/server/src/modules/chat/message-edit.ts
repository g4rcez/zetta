import type { Database } from "@zetta/db";
import { and, desc, eq, sql } from "@zetta/db/query";
import { message, messageRevision } from "@zetta/db/schema/chat";
import { topics } from "@zetta/core/live-topics";
import { events } from "../events/bus";
import { normalizeMentionText } from "./mention-text";
import { QUOTE_EXCERPT, savedQuote, sameText } from "./messages";
import { markSummaryStale } from "./summary";

/** Why a person's edit was refused. `NOT_FOUND` also covers a message of another conversation. */
export class MessageEditError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NOT_ALLOWED" | "INVALID",
    readonly safe: string,
  ) {
    super(safe);
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type MessageRow = typeof message.$inferSelect;

/**
 * Only what a person wrote in Zetta can be edited: a `user` message of the person's own. A bot's reply, a system line, a message an
 * outside person wrote through a channel (`meta.inbound`) and a poll (its text is the poll's question) are never changed.
 */
export function mayEdit(row: Pick<MessageRow, "role" | "ownerUserId" | "meta">, userId: string) {
  if (row.role !== "user" || row.ownerUserId !== userId) return false;
  const meta = row.meta as { inbound?: unknown; poll?: unknown } | null;
  return !meta?.inbound && !meta?.poll;
}

/** Messages of the same conversation that quote `edited`: their snapshot follows the new text. A quoted part that is still there stays. */
async function refreshQuotes(
  tx: Tx,
  conversationId: string,
  edited: { id: string; content: string },
) {
  const quoting = await tx
    .select({ id: message.id, meta: message.meta })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        sql`${message.meta}->'quote'->>'id' = ${edited.id}`,
      ),
    );
  for (const q of quoting) {
    const quote = savedQuote(q.meta);
    if (!quote) continue;
    const part = (q.meta as { quote?: { part?: unknown } }).quote?.part === true;
    const keep = part && sameText(edited.content, quote.excerpt);
    const excerpt = keep ? quote.excerpt : edited.content.slice(0, QUOTE_EXCERPT);
    const { part: _dropped, ...rest } = (q.meta as { quote: Record<string, unknown> }).quote;
    await tx
      .update(message)
      .set({
        meta: {
          ...(q.meta as object),
          quote: { ...rest, excerpt, ...(keep ? { part: true } : {}) },
        },
      })
      .where(eq(message.id, q.id));
  }
}

/**
 * Changes the text of a person's own message. One transaction: the old text goes to `message_revision`, the message gets the new text and
 * `edited_at`, the quotes of it in the same conversation follow, and the rolling summary is marked stale when it covers the message.
 * Nothing here starts a bot turn: a bot reads the new text the next time it reads the chat, and a message still waiting in the queue is
 * simply replaced. `mentions` replaces the stored mentions when given (`null` clears them); nobody is woken by an edit.
 */
export async function editUserMessage(
  db: Pick<Database, "transaction" | "select">,
  input: {
    conversationId: string;
    messageId: string;
    userId: string;
    content: string;
    /** The longest text a post of this kind takes. */
    max: number;
    /** The people who see the conversation change. */
    readers: string[];
    mentions?: unknown;
  },
): Promise<MessageRow> {
  const raw = input.content.trim();
  if (!raw || raw.length > input.max)
    throw new MessageEditError("INVALID", `Write between 1 and ${input.max} characters.`);
  const content = await normalizeMentionText(db, input.userId, raw);
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(message)
      .where(and(eq(message.id, input.messageId), eq(message.conversationId, input.conversationId)))
      .for("update");
    if (!current) throw new MessageEditError("NOT_FOUND", "That message is no longer available.");
    if (!mayEdit(current, input.userId))
      throw new MessageEditError("NOT_ALLOWED", "You can only edit your own messages.");
    if (current.content === content) return undefined;
    await tx.insert(messageRevision).values({
      messageId: current.id,
      content: current.content,
      editedByUserId: input.userId,
    });
    const [updated] = await tx
      .update(message)
      .set({
        content,
        editedAt: new Date(),
        ...(input.mentions !== undefined ? { mentions: input.mentions } : {}),
      })
      .where(eq(message.id, current.id))
      .returning();
    await refreshQuotes(tx, input.conversationId, { id: current.id, content });
    await markSummaryStale(tx, input.conversationId, current.seq);
    return updated!;
  });
  // An edit that changed nothing is not an edit: no revision, no mark, no signal.
  if (!row) {
    const [same] = await db.select().from(message).where(eq(message.id, input.messageId));
    return same!;
  }
  events.publish(input.readers, topics.conversation(input.conversationId));
  return row;
}

/** The earlier texts of a message, newest first. Only its author reads them. */
export async function messageRevisions(
  db: Pick<Database, "select">,
  input: { conversationId: string; messageId: string; userId: string },
) {
  const [current] = await db
    .select({ role: message.role, ownerUserId: message.ownerUserId, meta: message.meta })
    .from(message)
    .where(and(eq(message.id, input.messageId), eq(message.conversationId, input.conversationId)));
  if (!current) throw new MessageEditError("NOT_FOUND", "That message is no longer available.");
  if (current.ownerUserId !== input.userId || current.role !== "user")
    throw new MessageEditError("NOT_ALLOWED", "Only the author sees the earlier versions.");
  return db
    .select({
      id: messageRevision.id,
      content: messageRevision.content,
      createdAt: messageRevision.createdAt,
    })
    .from(messageRevision)
    .where(eq(messageRevision.messageId, input.messageId))
    .orderBy(desc(messageRevision.createdAt), desc(messageRevision.id));
}

import type { Database } from "@zetta/db";
import { and, desc, eq, sql } from "@zetta/db/query";
import { conversation, message } from "@zetta/db/schema/chat";
import { messagePin } from "@zetta/db/schema/features";

import { AccessError } from "../identity/access";

/** Pins a conversation can hold. More would make the bar a second copy of the chat. */
export const MAX_PINS = 50;
const EXCERPT = 160;

/** The conversation already holds `MAX_PINS` pins. */
export class PinLimitError extends Error {
  constructor() {
    super("PIN_LIMIT");
  }
}

/** A pinned message as the page shows it in the bar: who wrote it, the first words, and when it was pinned. */
export type PinView = {
  messageId: string;
  role: "user" | "assistant";
  botId: string | null;
  excerpt: string;
  pinnedByUserId: string;
  pinnedAt: Date;
};

/** The first words of a message on one line, for a bar that shows one line per pin. */
export const pinExcerpt = (content: string) =>
  content.replace(/\s+/g, " ").trim().slice(0, EXCERPT);

/** The pins of a conversation, newest first. */
export async function listPins(db: Database, conversationId: string): Promise<PinView[]> {
  const rows = await db
    .select({
      messageId: messagePin.messageId,
      role: message.role,
      botId: message.botId,
      content: message.content,
      pinnedByUserId: messagePin.pinnedByUserId,
      pinnedAt: messagePin.createdAt,
    })
    .from(messagePin)
    .innerJoin(message, eq(message.id, messagePin.messageId))
    .where(eq(messagePin.conversationId, conversationId))
    .orderBy(desc(messagePin.createdAt), desc(messagePin.id));
  return rows.map(({ content, role, ...r }) => ({
    ...r,
    role: role === "assistant" ? "assistant" : "user",
    excerpt: pinExcerpt(content),
  }));
}

/**
 * Pins a message of the conversation (not a system line). Pinning again changes nothing. The conversation's row is locked while the
 * count and the insert run, so two people pinning at once cannot go past the limit.
 */
export async function addPin(
  db: Database,
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: conversation.id })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .for("update");
    const [m] = await tx
      .select({ role: message.role })
      .from(message)
      .where(and(eq(message.id, messageId), eq(message.conversationId, conversationId)));
    if (!m || m.role === "system") throw new AccessError("NOT_FOUND");
    const [already] = await tx
      .select({ id: messagePin.id })
      .from(messagePin)
      .where(eq(messagePin.messageId, messageId));
    if (already) return;
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(messagePin)
      .where(eq(messagePin.conversationId, conversationId));
    if ((count?.n ?? 0) >= MAX_PINS) throw new PinLimitError();
    await tx
      .insert(messagePin)
      .values({ conversationId, messageId, pinnedByUserId: userId })
      .onConflictDoNothing();
  });
}

/** Removes the pin of a message. A message that is not pinned is left as it is. */
export async function removePin(
  db: Database,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await db
    .delete(messagePin)
    .where(and(eq(messagePin.conversationId, conversationId), eq(messagePin.messageId, messageId)));
}

import type { Database } from "@zetta/db";
import { and, eq, sql } from "@zetta/db/query";
import { conversation, message } from "@zetta/db/schema/chat";
import { discussion, discussionMember } from "@zetta/db/schema/discussions";

type Insert = typeof message.$inferInsert;
const code = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.code ??
  (e as { cause?: { code?: string } })?.cause?.code;

/** A bot tried to post where it does not belong: not its own chat and not a room it is a member of. */
export class BotPostNotAllowedError extends Error {
  readonly code = "BOT_POST_NOT_ALLOWED";
  constructor(conversationId: string, botId: string) {
    super(`Bot ${botId} may not post in conversation ${conversationId}.`);
  }
}

/**
 * A bot posts only in its own chat (`chat` or `inbound` conversation of that bot) or in a room (`discussion` conversation) where it is
 * a member. The same rule runs in the database as a trigger on `message`; this check gives a typed error before the insert.
 */
async function assertBotMayPost(
  db: Pick<Database, "select">,
  conversationId: string,
  botId: string,
) {
  const [c] = await db
    .select({ kind: conversation.kind, botId: conversation.botId })
    .from(conversation)
    .where(eq(conversation.id, conversationId));
  let allowed = c?.kind !== "discussion" && c?.botId === botId;
  if (c?.kind === "discussion") {
    const [member] = await db
      .select({ botId: discussionMember.botId })
      .from(discussionMember)
      .innerJoin(discussion, eq(discussion.id, discussionMember.discussionId))
      .where(and(eq(discussion.conversationId, conversationId), eq(discussionMember.botId, botId)));
    allowed = Boolean(member);
  }
  if (!allowed) throw new BotPostNotAllowedError(conversationId, botId);
}

/**
 * Inserts a message with the next free `seq` of its conversation, retrying when a concurrent writer (a running turn, an onboarding
 * answer, a routine) took the same number. Never trust a precomputed seq across awaits.
 */
export async function insertMessage(
  db: Pick<Database, "insert" | "select"> & Partial<Pick<Database, "transaction">>,
  conversationId: string,
  values: Omit<Insert, "seq" | "conversationId">,
) {
  if (values.botId) await assertBotMayPost(db, conversationId, values.botId);
  const seq = sql<number>`(select coalesce(max(${message.seq}), 0) + 1 from ${message} where ${message.conversationId} = ${conversationId})`;
  // A failed insert aborts the transaction it runs in, so inside one each attempt gets its own savepoint (a nested `transaction`).
  // A transaction object has `rollback`; the database handle does not.
  const nest = "rollback" in db ? db.transaction?.bind(db) : undefined;
  const write = (writer: Pick<Database, "insert">) =>
    writer
      .insert(message)
      .values({ ...values, conversationId, seq })
      .returning();
  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = nest ? await nest((savepoint) => write(savepoint)) : await write(db);
      return row!;
    } catch (e) {
      if (code(e) !== "23505" || attempt >= 6) throw e;
    }
  }
}
export const MAX_MESSAGE = 60_000;
export const clip = (text: string) =>
  text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 20)}\n…(truncated)` : text;

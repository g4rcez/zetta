import type { Database } from "@zetta/db";
import { sql } from "@zetta/db/query";
import { message } from "@zetta/db/schema/chat";

type Insert = typeof message.$inferInsert;
const code = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.code ??
  (e as { cause?: { code?: string } })?.cause?.code;

/**
 * Inserts a message with the next free `seq` of its conversation, retrying when a concurrent writer (a running turn, an onboarding
 * answer, a routine) took the same number. Never trust a precomputed seq across awaits.
 */
export async function insertMessage(
  db: Pick<Database, "insert">,
  conversationId: string,
  values: Omit<Insert, "seq" | "conversationId">,
) {
  const seq = sql<number>`(select coalesce(max(${message.seq}), 0) + 1 from ${message} where ${message.conversationId} = ${conversationId})`;
  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await db
        .insert(message)
        .values({ ...values, conversationId, seq })
        .returning();
      return row!;
    } catch (e) {
      if (code(e) !== "23505" || attempt >= 6) throw e;
    }
  }
}
export const MAX_MESSAGE = 60_000;
export const clip = (text: string) =>
  text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 20)}\n…(truncated)` : text;

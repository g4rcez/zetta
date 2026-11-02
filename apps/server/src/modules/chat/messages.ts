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
  db: Pick<Database, "insert"> & Partial<Pick<Database, "transaction">>,
  conversationId: string,
  values: Omit<Insert, "seq" | "conversationId">,
) {
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

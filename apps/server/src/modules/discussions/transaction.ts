import type { Database } from "@zetta/db";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const sqlstate = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.code ??
  (e as { cause?: { code?: string } })?.cause?.code;

/**
 * A room is written from two sides that lock in opposite orders: the room worker takes a turn and then its room, while most writers take the
 * room and then its turns. When both run at once Postgres aborts one of them with a deadlock (40P01). The victim is rolled back whole and has
 * changed nothing, so the right answer is to run it again, not to fail the person's request. Only a deadlock is retried.
 */
export async function transaction<T>(
  db: Pick<Database, "transaction">,
  run: (tx: Tx) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(run);
    } catch (e) {
      if (sqlstate(e) !== "40P01" || attempt >= attempts) throw e;
      // A little jitter, so the two that collided do not take the same locks at the same moment again.
      await Bun.sleep(20 * attempt + Math.random() * 20);
    }
  }
}

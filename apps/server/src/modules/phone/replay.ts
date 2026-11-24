import type { Database } from "@zetta/db";
import { eq, lt, sql } from "@zetta/db/query";
import { phoneWebhookEvent } from "@zetta/db/schema/phone";

/**
 * The ids of webhooks already handled, in the database: with several instances behind one address the provider's retry (or an attacker's
 * replay) can reach another instance than the first delivery, and only a shared record sees it. One insert decides who handles an event.
 */
export function createReplayStore(db: Pick<Database, "insert" | "delete">, keepMs = 3_600_000) {
  let lastPurge = 0;
  return {
    /** True when this call is the first to see the id; false when it was handled (or is being handled) already. */
    async claim(eventId: string): Promise<boolean> {
      const rows = await db
        .insert(phoneWebhookEvent)
        .values({ eventId })
        .onConflictDoNothing()
        .returning({ id: phoneWebhookEvent.eventId });
      const at = Date.now();
      if (at - lastPurge > 60_000) {
        lastPurge = at;
        void db
          .delete(phoneWebhookEvent)
          .where(lt(phoneWebhookEvent.seenAt, sql`now() - make_interval(secs => ${keepMs / 1000})`))
          .then(
            () => undefined,
            () => undefined,
          );
      }
      return rows.length > 0;
    },
    /** The handler failed and wants the provider's retry to be taken. */
    async release(eventId: string): Promise<void> {
      await db.delete(phoneWebhookEvent).where(eq(phoneWebhookEvent.eventId, eventId));
    },
  };
}
export type ReplayStore = ReturnType<typeof createReplayStore>;

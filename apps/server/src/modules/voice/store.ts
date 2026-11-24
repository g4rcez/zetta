import type { Database } from "@zetta/db";
import { and, eq, inArray, sql } from "@zetta/db/query";
import { voiceCall, type VoiceEndReason } from "@zetta/db/schema/voice";
import { recoverable, type RecoveryScope } from "../runtime/instance";

/** The `voice_call` rows: one per spoken call. The words are chat messages; this is the call itself. */
export function createCallStore(db: Database, instance: () => string | undefined) {
  return {
    /** A call that starts now (a web call is answered at once). */
    async open(c: {
      ownerUserId: string;
      botId: string;
      conversationId: string;
      language?: string | null;
    }) {
      const [row] = await db
        .insert(voiceCall)
        .values({
          ownerUserId: c.ownerUserId,
          botId: c.botId,
          conversationId: c.conversationId,
          channel: "web",
          direction: "in",
          trust: "owner",
          status: "active",
          language: c.language ?? null,
          answeredAt: new Date(),
          ownerInstance: instance() ?? null,
        })
        .returning();
      return row!;
    },
    /** The call is over. A second call for the same id changes nothing. */
    async finish(id: string, status: "ended" | "failed", reason: VoiceEndReason) {
      const [row] = await db
        .update(voiceCall)
        .set({
          status,
          endReason: reason,
          endedAt: sql`now()`,
          durationSeconds: sql`greatest(0, extract(epoch from now() - ${voiceCall.startedAt}))::int`,
          updatedAt: new Date(),
        })
        .where(and(eq(voiceCall.id, id), inArray(voiceCall.status, ["ringing", "active"])))
        .returning();
      return row;
    },
    async get(id: string) {
      return (await db.select().from(voiceCall).where(eq(voiceCall.id, id)))[0];
    },
    /**
     * Boot (and every recovery tick): calls still open whose server is gone cannot be live any more, so they are marked failed. A call
     * of a live instance (this one, or another worker) is left alone, the same rule as running turns (runtime/instance.ts).
     */
    async recover(scope?: RecoveryScope) {
      const rows = await db
        .update(voiceCall)
        .set({
          status: "failed",
          endReason: "restart",
          endedAt: sql`now()`,
          durationSeconds: sql`greatest(0, extract(epoch from now() - ${voiceCall.startedAt}))::int`,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(voiceCall.status, ["ringing", "active"]),
            recoverable(voiceCall.ownerInstance, scope),
          ),
        )
        .returning({ id: voiceCall.id });
      return rows.length;
    },
  };
}
export type CallStore = ReturnType<typeof createCallStore>;

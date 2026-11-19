import type { ItemUseExposure, ItemUseKind, ItemUseOrigin } from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { botLesson, itemUse, replyOutcome } from "@zetta/db/schema/learning";
import { botSkill, skill } from "@zetta/db/schema/skills";
import { relevant } from "./text";

/**
 * What was in front of a bot when it wrote one reply: the memory items and skills whose text it had, or asked for. Recorded once, right
 * after the reply is saved. Only text that was really in the prompt counts: a search hit that was only listed by title is not a use.
 */
export type RecordedReply = {
  replyId: string;
  conversationId: string;
  ownerUserId: string;
  botId: string;
  origin: ItemUseOrigin;
  harness: string;
  /** Memory items shown in full because they fit the message, or because the person picked them. */
  relevant: readonly string[];
  /** Memory items the bot read during the reply. */
  loaded: readonly string[];
  /** Skills Claude Code reported loading during the reply, by name (a `zetta-bot:` prefix is ignored). */
  skillNames: readonly string[];
  /** The bot's lessons that were in the prompt (the ids of their memory items). */
  lessons?: readonly string[];
  /** What the person asked and what the bot answered: a lesson counts as used when it is about that work (see text.ts `relevant`). */
  context?: string;
};

const RANK: Record<ItemUseExposure, number> = { shown: 0, always: 1, relevant: 2, loaded: 3 };

export function createUses(db: Database) {
  return {
    /**
     * Returns how many items the reply had. Every reply of a chat gets a verdict row, with or without items: "did the person have to step
     * in" is asked of all of a bot's replies, which is also what makes the bot's usual rate a fair thing to compare an item with.
     */
    async record(r: RecordedReply) {
      const refs = new Map<string, { kind: ItemUseKind; id: string; exposure: ItemUseExposure }>();
      const add = (kind: ItemUseKind, id: string, exposure: ItemUseExposure) => {
        const key = `${kind}:${id}`;
        const cur = refs.get(key);
        if (!cur || RANK[exposure] > RANK[cur.exposure]) refs.set(key, { kind, id, exposure });
      };
      for (const id of r.relevant) add("memory", id, "relevant");
      for (const id of r.loaded) add("memory", id, "loaded");
      if (r.lessons?.length) {
        // A lesson counts as used when it is about the work of this reply (or applies to every reply); otherwise it was only in the prompt.
        const known = await db
          .select({
            id: botLesson.memoryItemId,
            text: botLesson.text,
            topic: botLesson.topic,
            scope: botLesson.scope,
          })
          .from(botLesson)
          .where(inArray(botLesson.memoryItemId, [...r.lessons]));
        for (const l of known)
          if (l.id) add("memory", l.id, relevant(l, r.context ?? "") ? "relevant" : "shown");
      }
      const hermes = r.harness === "hermes";
      if (hermes || r.skillNames.length) {
        // Only the owner's library skills attached to this bot are tracked (the same rule as the skills page's usage).
        const attached = await db
          .select({ id: skill.id, name: skill.name })
          .from(botSkill)
          .innerJoin(skill, eq(skill.id, botSkill.skillId))
          .where(and(eq(botSkill.botId, r.botId), eq(skill.status, "active")));
        const asked = new Set(r.skillNames.map((n) => n.replace(/^[^:\s]+:/, "").trim()));
        for (const s of attached) {
          // Claude Code names the skills it loaded; Hermes carries every attached skill in its prompt.
          if (asked.has(s.name)) add("skill", s.id, "loaded");
          else if (hermes) add("skill", s.id, "always");
        }
      }
      if (refs.size)
        await db
          .insert(itemUse)
          .values(
            [...refs.values()].map((x) => ({
              ownerUserId: r.ownerUserId,
              botId: r.botId,
              conversationId: r.conversationId,
              messageId: r.replyId,
              refKind: x.kind,
              refId: x.id,
              exposure: x.exposure,
              origin: r.origin,
            })),
          )
          .onConflictDoNothing();
      const settled = r.origin === "server";
      await db
        .insert(replyOutcome)
        .values({
          messageId: r.replyId,
          ownerUserId: r.ownerUserId,
          botId: r.botId,
          origin: r.origin,
          outcome: settled ? "neutral" : "pending",
          ...(settled ? { resolvedAt: new Date() } : {}),
        })
        .onConflictDoNothing();
      return refs.size;
    },
  };
}
export type Uses = ReturnType<typeof createUses>;

import { LESSON_UNUSED_DAYS } from "@zetta/core/learning";
import { topics } from "@zetta/core/live-topics";
import type { Database } from "@zetta/db";
import { events } from "../events/bus";
import { raiseAttention } from "../features/attention";
import type { Lessons } from "./lessons";

/**
 * The daily forgetting (docs/decisions/lessons.md): a lesson that nothing used for a while is archived, with its reason written down and
 * a way back. Only lessons the bot learned (a memory item the system wrote): a skill or an item a person wrote is never archived by
 * itself, it only turns up as a suggestion. A person who turned "forget" off is left alone.
 */

const DAY = 86_400_000;

export function createForget(db: Database, deps: { lessons: Lessons; now?: () => Date }) {
  const now = () => deps.now?.() ?? new Date();
  let lastDay = "";
  let busy = false;

  return {
    /**
     * Archives the lessons nothing used for 30 days (on trial) or 60 days (kept). Time counts from the last use that counts, or from when
     * the lesson started or was brought back, whichever is later. Runs once a day; running it again is harmless. Returns how many.
     */
    async tick(opts: { force?: boolean } = {}) {
      if (busy) return 0;
      const today = now().toISOString().slice(0, 10);
      if (!opts.force && lastDay === today) return 0;
      busy = true;
      try {
        lastDay = today;
        const { rows } = await db.$client.query<{
          id: string;
          owner_user_id: string;
          bot_id: string;
          status: "trial" | "kept";
          text: string;
          last_activity: Date;
        }>(
          `select l.id, l.owner_user_id, l.bot_id, l.status, l.text,
                  greatest(
                    coalesce((select max(e.at) from bot_lesson_event e where e.lesson_id = l.id and e.kind in ('promoted', 'restored')), l.created_at),
                    coalesce((select max(u.created_at) from item_use u where u.ref_kind = 'memory' and u.ref_id = l.memory_item_id and u.exposure in ('relevant', 'loaded')), '-infinity'::timestamptz)
                  ) as last_activity
             from bot_lesson l
            where l.status in ('trial', 'kept') and l.memory_item_id is not null and l.skill_id is null
            limit 2000`,
        );
        const off = new Map<string, boolean>();
        const archived = new Map<string, string[]>();
        let n = 0;
        for (const r of rows) {
          const days = LESSON_UNUSED_DAYS[r.status];
          if (now().getTime() - new Date(r.last_activity).getTime() < days * DAY) continue;
          if (!off.has(r.owner_user_id))
            off.set(r.owner_user_id, (await deps.lessons.policy(r.owner_user_id)).forget === "off");
          if (off.get(r.owner_user_id)) continue;
          await deps.lessons.drop(
            r.owner_user_id,
            r.id,
            "unused",
            "system",
            `nothing used it for ${days} days`,
          );
          events.publish([r.owner_user_id], topics.botLearning(r.bot_id));
          archived.set(r.owner_user_id, [...(archived.get(r.owner_user_id) ?? []), r.text]);
          n++;
        }
        for (const [owner, texts] of archived)
          await raiseAttention(db, owner, {
            kind: "memory_updated",
            title: `${texts.length === 1 ? "A lesson was" : `${texts.length} lessons were`} archived: nothing used ${texts.length === 1 ? "it" : "them"}`,
            detail: texts
              .slice(0, 5)
              .map((t) => `• ${t}`)
              .join("\n"),
            nextAction: "Bring one back from the Lessons page if you want it.",
            resultLink: "/lessons?view=archived",
            source: "bot",
            sourceKey: `lessons-forgot:${owner}:${today}`,
          }).catch(() => undefined);
        return n;
      } finally {
        busy = false;
      }
    },
  };
}
export type Forget = ReturnType<typeof createForget>;

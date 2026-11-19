import {
  USEFULNESS_WINDOW_DAYS,
  trialDecision,
  type LearningStrictness,
} from "@zetta/core/learning";
import { topics } from "@zetta/core/live-topics";
import type { Database } from "@zetta/db";
import { events } from "../events/bus";
import { raiseAttention } from "../features/attention";
import type { Lessons } from "./lessons";
import { baselineBadRate, resolvedOutcomes } from "./stats";

/**
 * The trial (docs/decisions/lessons.md): a lesson that started is judged by what happened after the replies that used it. Kept after
 * enough resolved uses with nothing bad among the last few; dropped (archived, with a notice and a way back) after repeated bad
 * results that are clearly worse than the person's usual rate with this bot. Nothing here asks a model.
 */

const PER_TICK = 300;

export function createTrial(db: Database, deps: { lessons: Lessons; now?: () => Date }) {
  const now = () => deps.now?.() ?? new Date();
  let busy = false;

  return {
    /**
     * Looks at every lesson on trial and keeps or drops the ones that are decided. A person who turned "forget" off keeps the keeping
     * but loses the dropping: nothing is archived without them. Returns what it did.
     */
    async tick() {
      if (busy) return { kept: 0, dropped: 0 };
      busy = true;
      try {
        const { rows } = await db.$client.query<{
          id: string;
          owner_user_id: string;
          bot_id: string;
          memory_item_id: string;
          text: string;
          since: Date;
        }>(
          `select l.id, l.owner_user_id, l.bot_id, l.memory_item_id, l.text,
                  coalesce((select max(e.at) from bot_lesson_event e where e.lesson_id = l.id and e.kind in ('promoted', 'restored')), l.created_at) as since
             from bot_lesson l
            where l.status = 'trial' and l.memory_item_id is not null
            order by l.updated_at
            limit ${PER_TICK}`,
        );
        const window = new Date(now().getTime() - USEFULNESS_WINDOW_DAYS * 86_400_000);
        const policies = new Map<
          string,
          { forget: "on" | "off"; strictness: LearningStrictness }
        >();
        const baselines = new Map<string, number | null>();
        const dropped = new Map<string, string[]>();
        let kept = 0,
          droppedN = 0;
        for (const r of rows) {
          let policy = policies.get(r.owner_user_id);
          if (!policy) {
            const p = await deps.lessons.policy(r.owner_user_id);
            policy = { forget: p.forget, strictness: p.strictness };
            policies.set(r.owner_user_id, policy);
          }
          const key = `${r.owner_user_id}:${r.bot_id}`;
          if (!baselines.has(key))
            baselines.set(key, await baselineBadRate(db, r.owner_user_id, r.bot_id, window));
          const since = new Date(Math.max(new Date(r.since).getTime(), window.getTime()));
          const outcomes = await resolvedOutcomes(db, r.memory_item_id, since);
          const decision = trialDecision(outcomes, baselines.get(key) ?? null, policy.strictness);
          if (decision === "keep") {
            await deps.lessons.keep(r.owner_user_id, r.id, "system");
            events.publish([r.owner_user_id], topics.botLearning(r.bot_id));
            kept++;
          } else if (decision === "drop" && policy.forget === "on") {
            const bad = outcomes.filter((o) => o === "bad").length;
            await deps.lessons.drop(
              r.owner_user_id,
              r.id,
              "bad_results",
              "system",
              `the person stepped in after ${bad} of ${outcomes.length} replies that used it`,
            );
            events.publish([r.owner_user_id], topics.botLearning(r.bot_id));
            droppedN++;
            dropped.set(r.owner_user_id, [...(dropped.get(r.owner_user_id) ?? []), r.text]);
          }
        }
        // One notice per person: a lesson that did not help was dropped, and why, with a way back.
        for (const [owner, texts] of dropped)
          await raiseAttention(db, owner, {
            kind: "memory_updated",
            title: `${texts.length === 1 ? "A lesson" : `${texts.length} lessons`} did not help, so ${texts.length === 1 ? "it was" : "they were"} dropped`,
            detail: texts
              .slice(0, 5)
              .map((t) => `• ${t}`)
              .join("\n"),
            nextAction: "Bring one back from the Lessons page if you disagree.",
            resultLink: "/lessons?view=archived",
            source: "bot",
            sourceKey: `lessons-dropped:${owner}:${now().toISOString().slice(0, 10)}`,
          }).catch(() => undefined);
        return { kept, dropped: droppedN };
      } finally {
        busy = false;
      }
    },
  };
}
export type Trial = ReturnType<typeof createTrial>;

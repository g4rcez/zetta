import type { Database } from "@zetta/db";
import { LessonError } from "./lessons";

/**
 * Is a bot getting better? The one question nobody else answers (docs/decisions/lessons.md): how often the person had to step in after
 * its replies, week by week, with the lessons that started, were kept or dropped in each week next to it. A step in is a reply the person
 * stopped, redirected, corrected or rated down (`reply_outcome`, judged from what was stored, never from a model's opinion).
 */

const DAY = 86_400_000;
const WEEKS = 12;
/** A side of the comparison needs this many judged replies, or the numbers are noise. */
const MIN_REPLIES = 20;
/** The comparison sets the last four weeks against the four before. */
const SIDE_WEEKS = 4;

export type ProgressWeek = {
  /** The Monday the week starts (UTC, YYYY-MM-DD). */
  start: string;
  /** Replies that were judged in the week, and the ones the person stepped in on. */
  replies: number;
  stepIns: number;
  /** Step-ins per 100 replies, or null in a week with no judged reply. */
  per100: number | null;
  started: number;
  kept: number;
  dropped: number;
};
export type ProgressSide = { replies: number; stepIns: number; per100: number };

const mondayOf = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t;
};

export function createProgress(db: Database, deps: { now?: () => Date } = {}) {
  const now = () => deps.now?.() ?? new Date();
  const q = db.$client.query.bind(db.$client);

  return {
    async weekly(owner: string, botId: string) {
      const { rows: own } = await q("select 1 from bot where id = $1 and owner_user_id = $2", [
        botId,
        owner,
      ]);
      if (!own.length) throw new LessonError("NOT_FOUND", "That bot was not found.");
      const lastMonday = mondayOf(now());
      const first = new Date(lastMonday.getTime() - (WEEKS - 1) * 7 * DAY);
      const { rows: replies } = await q<{ wk: Date; replies: number; step_ins: number }>(
        `select date_trunc('week', created_at at time zone 'UTC') as wk,
                count(*)::int as replies, count(*) filter (where outcome = 'bad')::int as step_ins
           from reply_outcome
          where owner_user_id = $1 and bot_id = $2 and origin = 'person' and outcome <> 'pending' and created_at >= $3
          group by 1`,
        [owner, botId, first],
      );
      const { rows: events } = await q<{ wk: Date; kind: string; n: number }>(
        `select date_trunc('week', e.at at time zone 'UTC') as wk, e.kind, count(*)::int as n
           from bot_lesson_event e join bot_lesson l on l.id = e.lesson_id
          where l.owner_user_id = $1 and l.bot_id = $2 and e.at >= $3 and e.kind in ('promoted', 'kept', 'dropped')
          group by 1, 2`,
        [owner, botId, first],
      );
      const key = (d: Date) => new Date(d).toISOString().slice(0, 10);
      const byWeek = new Map(replies.map((r) => [key(r.wk), r]));
      const weeks: ProgressWeek[] = Array.from({ length: WEEKS }, (_, i) => {
        const start = key(new Date(first.getTime() + i * 7 * DAY));
        const r = byWeek.get(start);
        const count = (kind: string) =>
          events.find((e) => key(e.wk) === start && e.kind === kind)?.n ?? 0;
        return {
          start,
          replies: r?.replies ?? 0,
          stepIns: r?.step_ins ?? 0,
          per100: r && r.replies ? Math.round((r.step_ins * 1000) / r.replies) / 10 : null,
          started: count("promoted"),
          kept: count("kept"),
          dropped: count("dropped"),
        };
      });
      const side = (from: number, to: number): ProgressSide | null => {
        const slice = weeks.slice(from, to);
        const total = slice.reduce((n, w) => n + w.replies, 0);
        const bad = slice.reduce((n, w) => n + w.stepIns, 0);
        return total >= MIN_REPLIES
          ? { replies: total, stepIns: bad, per100: Math.round((bad * 1000) / total) / 10 }
          : null;
      };
      const { rows: counts } = await q<{ status: string; n: number }>(
        `select status, count(*)::int as n from bot_lesson where owner_user_id = $1 and bot_id = $2 group by 1`,
        [owner, botId],
      );
      const lessons = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<
        string,
        number
      >;
      return {
        weeks,
        recent: side(WEEKS - SIDE_WEEKS, WEEKS),
        earlier: side(WEEKS - 2 * SIDE_WEEKS, WEEKS - SIDE_WEEKS),
        lessons: {
          trial: lessons.trial ?? 0,
          kept: lessons.kept ?? 0,
          dropped: lessons.dropped ?? 0,
          waiting: lessons.candidate ?? 0,
        },
      };
    },
  };
}
export type Progress = ReturnType<typeof createProgress>;

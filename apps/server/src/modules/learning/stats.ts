import { COUNTED_EXPOSURES, type ItemUseKind } from "@zetta/core/learning";
import type { Database } from "@zetta/db";

/** At least this many judged replies before "how often the person steps in" is a usual rate worth comparing with. */
const BASELINE_MIN_JUDGED = 10;

/**
 * How often the person stepped in after a bot's replies in general: bad / (good + bad) over the judged replies since `since`, for one
 * bot, or for all of a person's bots. Null when there are too few to say. An item is read against this, so a person who corrects
 * everything a lot does not make every item look harmful.
 */
export async function baselineBadRate(
  db: Database,
  owner: string,
  bot: string | undefined,
  since: Date,
): Promise<number | null> {
  const { rows } = await db.$client.query<{ bad: number; judged: number }>(
    `select count(*) filter (where outcome = 'bad')::int as bad,
            count(*) filter (where outcome in ('good', 'bad'))::int as judged
       from reply_outcome
      where owner_user_id = $1 and origin = 'person' and created_at > $2 and ($3::uuid is null or bot_id = $3)`,
    [owner, since, bot ?? null],
  );
  const r = rows[0];
  return r && r.judged >= BASELINE_MIN_JUDGED ? r.bad / r.judged : null;
}

export type UseTotals = {
  uses: number;
  good: number;
  bad: number;
  ambient: number;
  lastUsedAt: Date | null;
};

/** What happened after the replies that used each of these items (memory items or skills), since `since`. */
export async function useTotals(
  db: Database,
  kind: ItemUseKind,
  ids: readonly string[],
  since: Date,
): Promise<Map<string, UseTotals>> {
  const out = new Map<string, UseTotals>();
  if (!ids.length) return out;
  const counted = COUNTED_EXPOSURES.map((e) => `'${e}'`).join(", ");
  const { rows } = await db.$client.query<{
    ref_id: string;
    uses: number;
    good: number;
    bad: number;
    ambient: number;
    last_used_at: Date | null;
  }>(
    `select iu.ref_id,
            count(*) filter (where iu.exposure in (${counted}))::int as uses,
            count(*) filter (where iu.exposure in (${counted}) and ro.outcome = 'good')::int as good,
            count(*) filter (where iu.exposure in (${counted}) and ro.outcome = 'bad')::int as bad,
            count(*) filter (where iu.exposure not in (${counted}))::int as ambient,
            max(iu.created_at) filter (where iu.exposure in (${counted})) as last_used_at
       from item_use iu
       left join reply_outcome ro on ro.message_id = iu.message_id
      where iu.ref_kind = $1 and iu.ref_id = any($2::uuid[]) and iu.created_at > $3
      group by iu.ref_id`,
    [kind, [...ids], since],
  );
  for (const r of rows)
    out.set(r.ref_id, {
      uses: r.uses,
      good: r.good,
      bad: r.bad,
      ambient: r.ambient,
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
    });
  return out;
}

/**
 * The resolved outcomes of the uses that count, oldest first, for one memory item: what a trial is judged on. A use whose reply is not
 * judged yet is left out; a neutral one counts as a use.
 */
export async function resolvedOutcomes(
  db: Database,
  itemId: string,
  since: Date,
): Promise<("good" | "bad" | "neutral")[]> {
  const counted = COUNTED_EXPOSURES.map((e) => `'${e}'`).join(", ");
  const { rows } = await db.$client.query<{ outcome: "good" | "bad" | "neutral" }>(
    `select ro.outcome
       from item_use iu
       join reply_outcome ro on ro.message_id = iu.message_id
      where iu.ref_kind = 'memory' and iu.ref_id = $1 and iu.exposure in (${counted})
        and ro.outcome <> 'pending' and iu.created_at > $2
      order by iu.created_at, iu.id`,
    [itemId, since],
  );
  return rows.map((r) => r.outcome);
}

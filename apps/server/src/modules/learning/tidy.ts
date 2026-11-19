import {
  KEPT_REVIEW,
  TIDY,
  TRIAL_DROP_MARGIN,
  USEFULNESS_WINDOW_DAYS,
  type FindingRef,
} from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { botLesson } from "@zetta/db/schema/learning";
import { raiseAttention } from "../features/attention";
import type { Findings } from "./findings";
import type { Lessons } from "./lessons";
import { baselineBadRate, resolvedOutcomes } from "./stats";
import { conflictingLessons, duplicateLessons } from "./tidy-rules";

/**
 * The weekly tidy-up (docs/decisions/lessons.md): looks for what a person would want to know about, with no model: lessons that say the
 * same thing or may pull against each other, items a newer one replaces, items nobody used for a long time, a kept lesson that stopped
 * helping. Everything it finds is a suggestion; it never changes a lesson or an item.
 */

const DAY = 86_400_000;
const OWNERS_PER_TICK = 5;
/** Memory items that are in the prompt whatever the message says, so "nothing used them" would be a wrong thing to say. */
const ALWAYS_IN_PROMPT = ["profile", "note", "list", "source", "drive", "lesson"];

/** The ISO week of a day, "2026-W47": a person is tidied once a week. */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - start.getTime()) / DAY + 1) / 7)).padStart(2, "0")}`;
}

export function createTidy(
  db: Database,
  deps: { lessons: Lessons; findings: Findings; now?: () => Date },
) {
  const now = () => deps.now?.() ?? new Date();
  const doneThisWeek = new Set<string>();
  let busy = false;
  const q = db.$client.query.bind(db.$client);
  // A quoted lesson often ends in a full stop of its own: the sentence around it supplies the punctuation.
  const quote = (t: string) => {
    const bare = t.trim().replace(/[.!?]+$/, "");
    return bare.length > 70 ? `${bare.slice(0, 67)}...` : bare;
  };

  /** Lessons in use, per bot: the same thing twice, a pair that may conflict, a kept one that stopped helping. */
  async function lessonFindings(owner: string) {
    const rows = await db
      .select()
      .from(botLesson)
      .where(
        and(
          eq(botLesson.ownerUserId, owner),
          inArray(botLesson.status, ["trial", "kept"]),
          eq(botLesson.kind, "rule"),
        ),
      );
    let made = 0;
    const bots = new Map<string, typeof rows>();
    for (const r of rows) bots.set(r.botId, [...(bots.get(r.botId) ?? []), r]);
    const since = new Date(now().getTime() - USEFULNESS_WINDOW_DAYS * DAY);
    for (const [botId, mine] of bots) {
      const lite = mine.map((l) => ({ id: l.id, text: l.text, createdAt: l.createdAt }));
      const ref = (l: { id: string }): FindingRef => ({ kind: "lesson", id: l.id });
      for (const p of duplicateLessons(lite))
        if (
          await deps.findings.create(owner, {
            botId,
            kind: "duplicate",
            refs: [ref(p.a), ref(p.b)],
            summary: `Two lessons say the same: “${quote(p.a.text)}” and “${quote(p.b.text)}”. Accepting drops the newer one.`,
          })
        )
          made++;
      const dups = new Set(duplicateLessons(lite).flatMap((p) => [p.a.id, p.b.id]));
      for (const p of conflictingLessons(lite.filter((l) => !dups.has(l.id))))
        if (
          await deps.findings.create(owner, {
            botId,
            kind: "check_pair",
            refs: [ref(p.a), ref(p.b)],
            summary: `These two lessons may pull in opposite directions: “${quote(p.a.text)}” and “${quote(p.b.text)}”. Drop the one that is wrong, or dismiss this if both are right.`,
          })
        )
          made++;
      // A kept lesson after which the person now steps in much more often than usual: the trial is over, so only the person drops it.
      const usual = await baselineBadRate(db, owner, botId, since);
      for (const l of mine.filter((x) => x.status === "kept" && x.memoryItemId)) {
        const last = (await resolvedOutcomes(db, l.memoryItemId!, since)).slice(
          -KEPT_REVIEW.lastUses,
        );
        if (last.length < KEPT_REVIEW.lastUses) continue;
        const rate = last.filter((o) => o === "bad").length / last.length;
        if (rate >= KEPT_REVIEW.minRate && rate >= (usual ?? 0) + TRIAL_DROP_MARGIN)
          if (
            await deps.findings.create(owner, {
              botId,
              kind: "drop_kept",
              refs: [ref(l)],
              summary: `After “${quote(l.text)}” you stepped in ${Math.round(rate * 100)}% of the last ${last.length} times it was used. Accepting drops it.`,
            })
          )
            made++;
      }
    }
    return made;
  }

  /** An item a current item replaces with a `supersedes` link, and that is still current: search already hides it, so it is only clutter. */
  async function supersededFindings(owner: string) {
    const { rows } = await q<{ old_id: string; old_title: string; new_title: string }>(
      `select distinct o.id as old_id, o.title as old_title, n.title as new_title
         from memory_link l
         join memory_item n on n.id = l.from_page_id and n.owner_user_id = $1 and n.status = 'current'
         join memory_item o on o.slug = l.to_slug and o.owner_user_id = n.owner_user_id and o.status = 'current' and o.id <> n.id
        where l.relation = 'supersedes' and not (o.tags @> array['lesson']::text[])
        limit 50`,
      [owner],
    );
    let made = 0;
    for (const r of rows)
      if (
        await deps.findings.create(owner, {
          kind: "superseded_current",
          refs: [{ kind: "memory", id: r.old_id }],
          summary: `“${quote(r.new_title)}” replaces “${quote(r.old_title)}”, which is still in your memory. Accepting archives the old one.`,
        })
      )
        made++;
    return made;
  }

  /** Two memory items whose nearest passages are almost the same by meaning: uses the embeddings already stored, so it needs no model. */
  async function duplicateItemFindings(owner: string) {
    const { rows } = await q<{ a_id: string; a_title: string; b_id: string; b_title: string }>(
      `select a.id as a_id, a.title as a_title, nn.page_id as b_id, nn.title as b_title
         from memory_item a
         join lateral (select embedding from memory_chunk where page_id = a.id and embedding is not null order by ord limit 1) c on true
         join lateral (
           select m.page_id, i.title, m.embedding <=> c.embedding as dist
             from memory_chunk m join memory_item i on i.id = m.page_id
            where i.owner_user_id = a.owner_user_id and i.status = 'current' and m.page_id <> a.id and m.embedding is not null
              and not (i.tags @> array['lesson']::text[])
            order by m.embedding <=> c.embedding limit 1) nn on true
        where a.owner_user_id = $1 and a.status = 'current' and a.type in ('owner', 'solo')
          and not (a.tags @> array['lesson']::text[]) and a.id < nn.page_id and nn.dist <= $2
        limit 30`,
      [owner, TIDY.itemDuplicateDistance],
    );
    let made = 0;
    for (const r of rows)
      if (
        await deps.findings.create(owner, {
          kind: "duplicate",
          refs: [
            { kind: "memory", id: r.a_id },
            { kind: "memory", id: r.b_id },
          ],
          summary: `“${quote(r.a_title)}” and “${quote(r.b_title)}” say nearly the same thing. Accepting keeps the first, links it as the one that replaces the second, and archives the second.`,
        })
      )
        made++;
    return made;
  }

  /** Items the person wrote that nothing used for a long time and that were not changed either. Never lessons, never what is always in the prompt. */
  async function unusedFindings(owner: string) {
    const { rows } = await q<{ id: string; title: string }>(
      `select i.id, i.title
         from memory_item i
        where i.owner_user_id = $1 and i.status = 'current' and i.type = 'owner' and i.slug <> 'memory-conventions'
          and i.updated_at < $2 and i.created_at < $2
          and not (i.tags && $3::text[])
          and not exists (select 1 from item_use u where u.ref_kind = 'memory' and u.ref_id = i.id and u.exposure in ('relevant', 'loaded') and u.created_at > $2)
        order by i.updated_at
        limit 20`,
      [owner, new Date(now().getTime() - TIDY.unusedItemDays * DAY), ALWAYS_IN_PROMPT],
    );
    let made = 0;
    for (const r of rows)
      if (
        await deps.findings.create(owner, {
          kind: "unused",
          refs: [{ kind: "memory", id: r.id }],
          summary: `“${quote(r.title)}” was not used by any bot, and not changed, for ${TIDY.unusedItemDays} days. Accepting archives it.`,
        })
      )
        made++;
    return made;
  }

  async function scan(owner: string) {
    return (
      (await lessonFindings(owner)) +
      (await supersededFindings(owner)) +
      (await duplicateItemFindings(owner)) +
      (await unusedFindings(owner))
    );
  }

  return {
    scan,

    /** Once a week per person whose "tidy" is on. Idempotent: the same suggestion is never filed twice. */
    async tick() {
      if (busy) return 0;
      busy = true;
      try {
        const week = isoWeek(now());
        const { rows } = await q<{ owner_user_id: string }>(
          `select distinct i.owner_user_id
             from memory_item i
             left join learning_policy p on p.owner_user_id = i.owner_user_id
            where coalesce(p.tidy, 'weekly') = 'weekly' and i.status = 'current'
              and exists (select 1 from membership m where m.user_id = i.owner_user_id and m.status = 'active')
            limit 500`,
        );
        let scanned = 0;
        for (const r of rows) {
          const key = `${r.owner_user_id}:${week}`;
          if (doneThisWeek.has(key)) continue;
          if (scanned >= OWNERS_PER_TICK) break;
          doneThisWeek.add(key);
          scanned++;
          const made = await scan(r.owner_user_id).catch(() => 0);
          if (made)
            await raiseAttention(db, r.owner_user_id, {
              kind: "memory_updated",
              title: `${made === 1 ? "One suggestion" : `${made} suggestions`} to tidy up what your bots know`,
              detail:
                "Lessons that repeat or pull against each other, items that were replaced, and items nobody uses.",
              nextAction: "Accept or dismiss each one. Nothing changes until you do.",
              resultLink: "/lessons?tab=suggestions",
              source: "bot",
              sourceKey: `lessons-tidy:${r.owner_user_id}:${week}`,
            }).catch(() => undefined);
        }
        return scanned;
      } finally {
        busy = false;
      }
    },
  };
}
export type Tidy = ReturnType<typeof createTidy>;

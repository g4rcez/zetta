import { ITEM_USE_KEEP_DAYS } from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import type { Uses } from "./uses";

/**
 * Builds the record of past replies from what they already hold, for the last `ITEM_USE_KEEP_DAYS` days: a verdict row for every reply
 * (so the trend of "how often the person stepped in" has its history) and the uses of the memory items shown in full
 * (`meta.used.instructions`), so the usefulness view is not empty the day it ships. Run once when the server starts; safe to run
 * again and to stop half way: a reply that already has a verdict is skipped, and the work goes in order of time.
 *
 * What it cannot know: which skills a past reply loaded, which items the bot read itself, and who started a turn. It reads only chats
 * (not routine runs, saved tests or memory jobs, where nobody reads the reply and writes back), and counts them as the person's.
 */
const BATCH = 300;

let running = false;

export function createBackfill(db: Database, uses: Uses) {
  return {
    /** Returns how many replies were recorded. A second call while one runs returns 0. */
    async run(now = new Date()) {
      if (running) return 0;
      running = true;
      let done = 0;
      try {
        let afterAt = new Date(now.getTime() - ITEM_USE_KEEP_DAYS * 86_400_000);
        let afterId = "00000000-0000-0000-0000-000000000000";
        for (;;) {
          const { rows } = await db.$client.query<{
            id: string;
            conversation_id: string;
            owner_user_id: string;
            bot_id: string;
            created_at: Date;
            ids: string[];
          }>(
            `select m.id, m.conversation_id, m.owner_user_id, m.author_bot_id as bot_id, m.created_at,
                    (select coalesce(array_agg(i->>'id'), '{}')
                       from jsonb_array_elements(case when jsonb_typeof(m.meta->'used'->'instructions') = 'array' then m.meta->'used'->'instructions' else '[]'::jsonb end) i) as ids
               from message m
               join conversation c on c.id = m.conversation_id
              where m.role = 'assistant'
                and m.status in ('complete', 'cancelled')
                and m.author_bot_id is not null
                and c.kind = 'chat'
                and (m.created_at, m.id) > ($1::timestamptz, $2::uuid)
                and not exists (select 1 from reply_outcome ro where ro.message_id = m.id)
                and not exists (select 1 from routine_run r where r.conversation_id = c.id)
                and not exists (select 1 from bot_drive_run d where d.conversation_id = c.id)
                and not exists (select 1 from memory_job j where j.conversation_id = c.id)
              order by m.created_at, m.id
              limit ${BATCH}`,
            [afterAt, afterId],
          );
          if (!rows.length) break;
          for (const r of rows) {
            const ids = (r.ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
            await uses.record({
              replyId: r.id,
              conversationId: r.conversation_id,
              ownerUserId: r.owner_user_id,
              botId: r.bot_id,
              origin: "person",
              harness: "",
              relevant: ids,
              loaded: [],
              skillNames: [],
            });
            done++;
          }
          const last = rows.at(-1)!;
          afterAt = new Date(last.created_at);
          afterId = last.id;
        }
        return done;
      } finally {
        running = false;
      }
    },
  };
}
export type Backfill = ReturnType<typeof createBackfill>;

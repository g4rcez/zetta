import {
  isReservedBotName,
  legacyMentions,
  mentionKey,
  normalizeMentions,
  refreshMentions,
  type MentionKind,
  type MentionTarget,
} from "@zetta/core/mentions";
import type { Database } from "@zetta/db";
import { and, asc, eq, or, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { discussion } from "@zetta/db/schema/discussions";
import { team } from "@zetta/db/schema/teams";

/**
 * Text is stored with mention tokens (`[@Dev](bot:<id>)`), so a rename never breaks it. A person, a model or an old routine may still write
 * `@Dev` or `#Core`: this turns those words into tokens for what `ownerUserId` can address, before the text is stored.
 * Rules: of two bots with one name the owner's own wins, then the oldest; a `#word` that names both a team and a room is left as written.
 * It costs queries only when the text has a real `@word`/`#word`; `@user` and friends are not bots and never trigger one.
 */
export async function normalizeMentionText(
  db: Pick<Database, "select">,
  ownerUserId: string,
  text: string,
): Promise<string> {
  const words = legacyMentions(text).filter((w) => w.sigil === "#" || !isReservedBotName(w.key));
  if (!words.length) return text;

  const bots = new Map<string, MentionTarget>();
  if (words.some((w) => w.sigil === "@")) {
    const rows = await db
      .select({ id: bot.id, name: bot.name, owner: bot.ownerUserId })
      .from(bot)
      .where(
        and(
          eq(bot.archived, false),
          or(eq(bot.ownerUserId, ownerUserId), eq(bot.visibility, "team")),
        ),
      )
      .orderBy(asc(bot.createdAt));
    rows.sort((x, y) => Number(y.owner === ownerUserId) - Number(x.owner === ownerUserId));
    for (const r of rows) {
      const key = mentionKey(r.name);
      if (!bots.has(key)) bots.set(key, { kind: "bot", id: r.id, name: r.name });
    }
  }

  const tags = new Map<string, MentionTarget | null>();
  if (words.some((w) => w.sigil === "#")) {
    const [teams, rooms] = await Promise.all([
      db
        .select({ id: team.id, name: team.name })
        .from(team)
        .where(and(eq(team.ownerUserId, ownerUserId), eq(team.status, "active")))
        .orderBy(asc(team.createdAt)),
      db
        .select({ id: discussion.id, name: discussion.title })
        .from(discussion)
        .where(and(eq(discussion.ownerUserId, ownerUserId), eq(discussion.kind, "room")))
        .orderBy(asc(discussion.createdAt)),
    ]);
    const add = (kind: "team" | "room", id: string, name: string) => {
      const key = mentionKey(name);
      const seen = tags.get(key);
      if (seen === undefined) tags.set(key, { kind, id, name });
      else if (seen && seen.kind !== kind) tags.set(key, null);
    };
    for (const t of teams) add("team", t.id, t.name);
    for (const r of rooms) add("room", r.id, r.name);
  }

  return normalizeMentions(text, (sigil, key) =>
    sigil === "@" ? bots.get(key) : (tags.get(key) ?? undefined),
  );
}

/** Where stored text can hold a mention token: table, key column, text column. Memory history (`memory_revision`) and bot snapshots stay as they were. */
const TEXT_COLUMNS = [
  ["message", "id", "content"],
  ["routine", "id", "prompt"],
  ["discussion", "id", "goal"],
  ["discussion", "id", "context"],
  ["team", "id", "goal"],
  ["team", "id", "context"],
  ["task", "id", "title"],
  ["task", "id", "description"],
  ["bot", "id", "instructions"],
  ["bot", "id", "personality"],
  ["bot", "id", "description"],
  ["goal_loop", "id", "goal"],
  ["goal_loop", "id", "done_when"],
  ["goal_loop", "id", "progress"],
  ["bot_claude_config", "bot_id", "append_prompt"],
  ["memory_item", "id", "howto"],
  ["memory_item", "id", "content"],
  ["memory_suggestion", "id", "howto"],
  ["memory_suggestion", "id", "content"],
] as const;

/**
 * After a bot, team or room is renamed: sets the label of every stored token that points to it to the new name (chat, rooms, memory,
 * routines, tasks, loops, bot instructions). The label is only a hint, but models and the MCP server read the stored text as it is.
 * Call it when a name is saved, also when it did not change, so a retry after a failure still finishes the job.
 */
export async function refreshMentionLabels(
  db: Pick<Database, "execute">,
  kind: MentionKind,
  id: string,
  name: string,
): Promise<void> {
  const names = new Map([[id.toLowerCase(), name]]);
  const hit = `%(${kind}:${id})%`;
  const table = (t: string) => sql`"zetta".${sql.identifier(t)}`;
  const change = async (t: string, key: string, col: string) => {
    const { rows } = await db.execute<{ id: string; text: string }>(
      sql`select ${sql.identifier(key)} as id, ${sql.identifier(col)} as text from ${table(t)} where ${sql.identifier(col)} ilike ${hit}`,
    );
    for (const r of rows) {
      const next = refreshMentions(r.text, names);
      if (next !== r.text)
        await db.execute(
          sql`update ${table(t)} set ${sql.identifier(col)} = ${next} where ${sql.identifier(key)} = ${r.id}`,
        );
    }
  };
  for (const [t, key, col] of TEXT_COLUMNS) await change(t, key, col);
  // A room that waits for approval keeps its first message in the proposal.
  const { rows } = await db.execute<{ id: string; text: string }>(
    sql`select id, patch->>'firstMessage' as text from "zetta"."config_proposal" where jsonb_typeof(patch->'firstMessage') = 'string' and patch->>'firstMessage' ilike ${hit}`,
  );
  for (const r of rows) {
    const next = refreshMentions(r.text, names);
    if (next !== r.text)
      await db.execute(
        sql`update "zetta"."config_proposal" set patch = jsonb_set(patch, '{firstMessage}', to_jsonb(${next}::text)) where id = ${r.id}`,
      );
  }
}

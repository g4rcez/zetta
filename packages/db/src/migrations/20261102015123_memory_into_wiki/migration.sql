-- Memory becomes wiki items. Each memory keeps its id, so the frozen prompt of a conversation (conversation.memory_snapshot) and the
-- provenance of old answers (meta.used.memories) still resolve. A bot's notes are `solo` items of that bot; the person's profile is
-- `owner` items tagged profile. Both sets are put in every prompt, best score first (features/knowledge.ts).
INSERT INTO "wiki_page" ("id", "owner_user_id", "slug", "title", "type", "howto", "content", "tags", "score", "status", "version", "updated_by", "updated_by_bot_id", "author_bot_id", "created_at", "updated_at")
SELECT m."id", m."owner_user_id",
  'memory-' || coalesce(nullif(trim(both '-' from left(regexp_replace(lower(f_unaccent(left(m."content", 40))), '[^a-z0-9]+', '-', 'g'), 40)), ''), 'note') || '-' || right(m."id"::text, 6),
  left(btrim(regexp_replace(m."content", '\s+', ' ', 'g')), 60),
  CASE WHEN m."target" = 'memory' AND m."bot_id" IS NOT NULL THEN 'solo' ELSE 'owner' END,
  '', m."content",
  ARRAY[CASE WHEN m."target" = 'user' THEN 'profile' ELSE 'memory' END, m."category"]::text[],
  CASE WHEN m."target" = 'user' THEN 90 ELSE 80 END,
  'current', m."version",
  CASE WHEN m."source" = 'bot' THEN 'bot' ELSE 'user' END,
  CASE WHEN m."source" = 'bot' THEN m."bot_id" END,
  CASE WHEN m."target" = 'memory' THEN m."bot_id" END,
  m."created_at", m."created_at"
FROM "memory" m;--> statement-breakpoint
INSERT INTO "wiki_revision" ("page_id", "owner_user_id", "version", "title", "howto", "content", "tags", "status", "author", "bot_id")
SELECT "id", "owner_user_id", "version", "title", "howto", "content", "tags", "status", "updated_by", "updated_by_bot_id" FROM "wiki_page" WHERE "id" IN (SELECT "id" FROM "memory");--> statement-breakpoint
-- A proposal to save a memory waits for approval as a proposal to write a wiki item. One that cannot map to a single new item (a
-- patch, a remove or several operations) is marked stale: the bot can propose it again.
UPDATE "config_proposal" SET "status" = 'stale' WHERE "kind" = 'create_memory' AND "status" = 'pending' AND NOT (jsonb_array_length("patch" -> 'ops') = 1 AND "patch" -> 'ops' -> 0 ->> 'op' = 'add');--> statement-breakpoint
UPDATE "config_proposal" SET "kind" = 'create_wiki_page', "patch" = CASE WHEN "status" = 'pending' THEN jsonb_build_object(
  'args', jsonb_build_object(
    'action', 'write',
    'slug', 'memory-' || left(md5(coalesce("patch" ->> 'botId', '') || (("patch" -> 'ops' -> 0) ->> 'content')), 12),
    'title', left(btrim(regexp_replace(("patch" -> 'ops' -> 0) ->> 'content', '\s+', ' ', 'g')), 60),
    'content', ("patch" -> 'ops' -> 0) ->> 'content',
    'tags', jsonb_build_array(CASE WHEN "patch" ->> 'target' = 'user' THEN 'profile' ELSE 'memory' END),
    'type', CASE WHEN "patch" ->> 'target' = 'user' THEN 'owner' ELSE 'solo' END,
    'score', CASE WHEN "patch" ->> 'target' = 'user' THEN 90 ELSE 80 END),
  'botId', "patch" ->> 'botId',
  'conversationId', null,
  'teamId', null) ELSE "patch" END
WHERE "kind" = 'create_memory';--> statement-breakpoint
DROP TABLE "memory";

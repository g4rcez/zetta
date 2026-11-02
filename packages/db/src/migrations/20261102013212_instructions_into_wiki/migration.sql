-- Instructions become wiki items. Each instruction keeps its id, so message provenance (meta.used.instructions) and links still resolve.
-- slug: the title as words + the last 6 characters of the id (unique, stable). The Check section carries the old verification text.
INSERT INTO "wiki_page" ("id", "owner_user_id", "slug", "title", "type", "howto", "content", "tags", "score", "status", "version", "updated_by", "updated_by_bot_id", "author_bot_id", "created_at", "updated_at")
SELECT i."id", i."owner_user_id",
  coalesce(nullif(trim(both '-' from left(regexp_replace(lower(f_unaccent(i."title")), '[^a-z0-9]+', '-', 'g'), 60)), ''), 'instruction') || '-' || right(i."id"::text, 6),
  i."title",
  CASE WHEN i."team_id" IS NULL THEN 'owner' ELSE 'teams' END,
  i."trigger",
  i."body" || CASE WHEN i."verification" <> '' THEN E'\n\n## Check\n' || i."verification" ELSE '' END,
  ARRAY['instruction']::text[], 70,
  CASE WHEN i."archived" THEN 'archived' ELSE 'current' END,
  i."version",
  CASE WHEN i."created_by_bot_id" IS NULL THEN 'user' ELSE 'bot' END,
  i."created_by_bot_id", i."created_by_bot_id", i."created_at", i."created_at"
FROM "instruction" i;--> statement-breakpoint
INSERT INTO "wiki_page_team" ("page_id", "team_id") SELECT "id", "team_id" FROM "instruction" WHERE "team_id" IS NOT NULL;--> statement-breakpoint
-- One revision for the version the item starts at.
INSERT INTO "wiki_revision" ("page_id", "owner_user_id", "version", "title", "howto", "content", "tags", "status", "author", "bot_id")
SELECT "id", "owner_user_id", "version", "title", "howto", "content", "tags", "status", "updated_by", "author_bot_id" FROM "wiki_page" WHERE "id" IN (SELECT "id" FROM "instruction");--> statement-breakpoint
-- Edges from links already written in the bodies.
INSERT INTO "wiki_link" ("from_page_id", "relation", "to_slug") SELECT DISTINCT p."id", 'related', m[1] FROM "wiki_page" p, regexp_matches(p."content", '\[\[([a-z0-9-]+)\]\]', 'g') m WHERE p."id" IN (SELECT "id" FROM "instruction") AND m[1] <> p."slug" ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Messages waiting in a chat queue and discussion posts name their picked items under a new key.
UPDATE "chat_queue" SET "input" = ("input" - 'instructionIds') || jsonb_build_object('wikiIds', "input" -> 'instructionIds') WHERE "input" ? 'instructionIds';--> statement-breakpoint
UPDATE "message" SET "meta" = ("meta" - 'instructionIds') || jsonb_build_object('wikiIds', "meta" -> 'instructionIds') WHERE "meta" ? 'instructionIds';--> statement-breakpoint
-- Proposals to save an instruction become proposals to write a wiki item.
UPDATE "config_proposal" SET "kind" = 'create_wiki_page', "patch" = jsonb_build_object(
  'args', jsonb_build_object(
    'action', 'write',
    'slug', coalesce(nullif(trim(both '-' from left(regexp_replace(lower(f_unaccent("patch" ->> 'title')), '[^a-z0-9]+', '-', 'g'), 60)), ''), 'instruction') || '-' || right("id"::text, 6),
    'title', "patch" ->> 'title',
    'content', ("patch" ->> 'body') || CASE WHEN coalesce("patch" ->> 'verification', '') <> '' THEN E'\n\n## Check\n' || ("patch" ->> 'verification') ELSE '' END,
    'howto', coalesce("patch" ->> 'trigger', ''),
    'tags', jsonb_build_array('instruction')),
  'botId', coalesce("patch" ->> 'createdByBotId', "bot_id"::text),
  'conversationId', null,
  'teamId', "patch" -> 'teamId')
WHERE "kind" = 'create_instruction';--> statement-breakpoint
DROP TABLE "instruction";

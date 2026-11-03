-- A mention of a bot, team or room is stored as a Markdown link with the id: [@Dev](bot:<id>), [#Core](team:<id>), [#Launch](room:<id>).
-- A rename then never breaks stored text. This rewrites the `@Name` / `#Name` words that older text still holds. It only adds tokens:
-- code (fences and `inline`), links and URLs are left alone, a word that names nothing stays as written, and running it twice changes nothing.
-- The rules are those of normalizeMentions / normalizeMentionText (packages/core/src/mentions.ts, apps/server/src/modules/chat/mention-text.ts).
CREATE FUNCTION "zetta"."_mention_token"(sig text, kind text, id uuid, name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT '[' || sig || regexp_replace(left(btrim(regexp_replace(name, '\s+', ' ', 'g')), 80), '([\\\[\]])', '\\\1', 'g') || '](' || kind || ':' || id || ')'
$fn$;
--> statement-breakpoint
-- Text outside a fenced block. Of two bots with one name the owner's own wins, then the oldest; a `#word` that names both a team and a room stays.
CREATE FUNCTION "zetta"."_mention_plain"(txt text, owner_id text) RETURNS text
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  re CONSTANT text := '`[^`\n]*`|\[(?:\\.|[^]\\\n])*\]\([^)\n]*\)|https?://\S+|(?<![[:alnum:]_])[@#][[:alnum:]_-]{1,40}';
  s int := 1;
  a int;
  m text;
  out text := '';
  sig text;
  key text;
  t_id uuid;
  t_name text;
  team_id uuid;
  team_name text;
  room_id uuid;
  room_name text;
BEGIN
  LOOP
    a := regexp_instr(txt, re, s);
    EXIT WHEN a = 0;
    m := regexp_substr(txt, re, s);
    out := out || substr(txt, s, a - s);
    s := a + length(m);
    IF left(m, 1) NOT IN ('@', '#') THEN
      out := out || m;
      CONTINUE;
    END IF;
    sig := left(m, 1);
    key := lower(substr(m, 2));
    t_id := NULL;
    IF sig = '@' THEN
      IF key NOT IN ('user', 'channel', 'here', 'all') THEN
        SELECT b.id, b.name INTO t_id, t_name FROM "zetta"."bot" b
         WHERE b.archived = false
           AND (b.owner_user_id = owner_id OR b.visibility = 'team')
           AND lower(regexp_replace(b.name, '\s+', '', 'g')) = key
         ORDER BY (b.owner_user_id = owner_id) DESC, b.created_at ASC
         LIMIT 1;
      END IF;
      IF t_id IS NOT NULL THEN
        out := out || "zetta"."_mention_token"('@', 'bot', t_id, t_name);
        CONTINUE;
      END IF;
    ELSE
      team_id := NULL;
      room_id := NULL;
      SELECT t.id, t.name INTO team_id, team_name FROM "zetta"."team" t
       WHERE t.owner_user_id = owner_id AND t.status = 'active'
         AND lower(regexp_replace(t.name, '\s+', '', 'g')) = key
       ORDER BY t.created_at ASC LIMIT 1;
      SELECT d.id, d.title INTO room_id, room_name FROM "zetta"."discussion" d
       WHERE d.owner_user_id = owner_id AND d.kind = 'room'
         AND lower(regexp_replace(d.title, '\s+', '', 'g')) = key
       ORDER BY d.created_at ASC LIMIT 1;
      IF team_id IS NOT NULL AND room_id IS NULL THEN
        out := out || "zetta"."_mention_token"('#', 'team', team_id, team_name);
        CONTINUE;
      ELSIF room_id IS NOT NULL AND team_id IS NULL THEN
        out := out || "zetta"."_mention_token"('#', 'room', room_id, room_name);
        CONTINUE;
      END IF;
    END IF;
    out := out || m;
  END LOOP;
  RETURN out || substr(txt, s);
END
$fn$;
--> statement-breakpoint
-- Splitting on the fence marks the pieces inside a fenced block (the even ones; an unclosed fence runs to the end) and leaves them as they are.
CREATE FUNCTION "zetta"."_mention_tokens"(txt text, owner_id text) RETURNS text
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  parts text[];
  i int;
BEGIN
  IF txt IS NULL OR txt !~ '[@#]' THEN
    RETURN txt;
  END IF;
  parts := string_to_array(txt, '```');
  FOR i IN 1..array_length(parts, 1) BY 2 LOOP
    parts[i] := "zetta"."_mention_plain"(parts[i], owner_id);
  END LOOP;
  RETURN array_to_string(parts, '```');
END
$fn$;
--> statement-breakpoint
UPDATE "zetta"."message" m SET "content" = n.c
  FROM (SELECT "id", "zetta"."_mention_tokens"("content", "owner_user_id") AS c FROM "zetta"."message" WHERE "role" <> 'system' AND "content" ~ '[@#]') n
  WHERE m."id" = n."id" AND m."content" IS DISTINCT FROM n.c;
--> statement-breakpoint
UPDATE "zetta"."routine" SET "prompt" = "zetta"."_mention_tokens"("prompt", "owner_user_id")
  WHERE "prompt" ~ '[@#]' AND "prompt" IS DISTINCT FROM "zetta"."_mention_tokens"("prompt", "owner_user_id");
--> statement-breakpoint
UPDATE "zetta"."discussion" SET
  "goal" = "zetta"."_mention_tokens"("goal", "owner_user_id"),
  "context" = "zetta"."_mention_tokens"("context", "owner_user_id")
  WHERE ("goal" ~ '[@#]' OR "context" ~ '[@#]')
    AND ("goal" IS DISTINCT FROM "zetta"."_mention_tokens"("goal", "owner_user_id") OR "context" IS DISTINCT FROM "zetta"."_mention_tokens"("context", "owner_user_id"));
--> statement-breakpoint
UPDATE "zetta"."team" SET
  "goal" = "zetta"."_mention_tokens"("goal", "owner_user_id"),
  "context" = "zetta"."_mention_tokens"("context", "owner_user_id")
  WHERE ("goal" ~ '[@#]' OR "context" ~ '[@#]')
    AND ("goal" IS DISTINCT FROM "zetta"."_mention_tokens"("goal", "owner_user_id") OR "context" IS DISTINCT FROM "zetta"."_mention_tokens"("context", "owner_user_id"));
--> statement-breakpoint
UPDATE "zetta"."task" SET
  "title" = "zetta"."_mention_tokens"("title", "owner_user_id"),
  "description" = "zetta"."_mention_tokens"("description", "owner_user_id")
  WHERE ("title" ~ '[@#]' OR "description" ~ '[@#]')
    AND ("title" IS DISTINCT FROM "zetta"."_mention_tokens"("title", "owner_user_id") OR "description" IS DISTINCT FROM "zetta"."_mention_tokens"("description", "owner_user_id"));
--> statement-breakpoint
UPDATE "zetta"."bot" SET
  "instructions" = "zetta"."_mention_tokens"("instructions", "owner_user_id"),
  "personality" = "zetta"."_mention_tokens"("personality", "owner_user_id"),
  "description" = "zetta"."_mention_tokens"("description", "owner_user_id")
  WHERE ("instructions" ~ '[@#]' OR "personality" ~ '[@#]' OR "description" ~ '[@#]')
    AND ("instructions" IS DISTINCT FROM "zetta"."_mention_tokens"("instructions", "owner_user_id")
      OR "personality" IS DISTINCT FROM "zetta"."_mention_tokens"("personality", "owner_user_id")
      OR "description" IS DISTINCT FROM "zetta"."_mention_tokens"("description", "owner_user_id"));
--> statement-breakpoint
UPDATE "zetta"."goal_loop" SET
  "goal" = "zetta"."_mention_tokens"("goal", "owner_user_id"),
  "done_when" = "zetta"."_mention_tokens"("done_when", "owner_user_id"),
  "progress" = "zetta"."_mention_tokens"("progress", "owner_user_id")
  WHERE ("goal" ~ '[@#]' OR "done_when" ~ '[@#]' OR "progress" ~ '[@#]')
    AND ("goal" IS DISTINCT FROM "zetta"."_mention_tokens"("goal", "owner_user_id")
      OR "done_when" IS DISTINCT FROM "zetta"."_mention_tokens"("done_when", "owner_user_id")
      OR "progress" IS DISTINCT FROM "zetta"."_mention_tokens"("progress", "owner_user_id"));
--> statement-breakpoint
UPDATE "zetta"."bot_claude_config" c SET "append_prompt" = "zetta"."_mention_tokens"(c."append_prompt", b."owner_user_id")
  FROM "zetta"."bot" b
  WHERE b."id" = c."bot_id" AND c."append_prompt" ~ '[@#]'
    AND c."append_prompt" IS DISTINCT FROM "zetta"."_mention_tokens"(c."append_prompt", b."owner_user_id");
--> statement-breakpoint
-- Wiki pages and suggestions. A page that holds a synced Drive document keeps the document's text as it is.
UPDATE "zetta"."wiki_page" p SET
  "howto" = "zetta"."_mention_tokens"(p."howto", p."owner_user_id"),
  "content" = "zetta"."_mention_tokens"(p."content", p."owner_user_id")
  WHERE (p."howto" ~ '[@#]' OR p."content" ~ '[@#]')
    AND NOT EXISTS (SELECT 1 FROM "zetta"."knowledge_doc" d WHERE d."page_id" = p."id")
    AND (p."howto" IS DISTINCT FROM "zetta"."_mention_tokens"(p."howto", p."owner_user_id")
      OR p."content" IS DISTINCT FROM "zetta"."_mention_tokens"(p."content", p."owner_user_id"));
--> statement-breakpoint
UPDATE "zetta"."wiki_suggestion" SET
  "howto" = "zetta"."_mention_tokens"("howto", "page_owner_user_id"),
  "content" = "zetta"."_mention_tokens"("content", "page_owner_user_id")
  WHERE ("howto" ~ '[@#]' OR "content" ~ '[@#]')
    AND ("howto" IS DISTINCT FROM "zetta"."_mention_tokens"("howto", "page_owner_user_id")
      OR "content" IS DISTINCT FROM "zetta"."_mention_tokens"("content", "page_owner_user_id"));
--> statement-breakpoint
UPDATE "zetta"."config_proposal" SET "patch" = jsonb_set("patch", '{firstMessage}', to_jsonb("zetta"."_mention_tokens"("patch"->>'firstMessage', "owner_user_id")))
  WHERE jsonb_typeof("patch"->'firstMessage') = 'string' AND "patch"->>'firstMessage' ~ '[@#]'
    AND "patch"->>'firstMessage' IS DISTINCT FROM "zetta"."_mention_tokens"("patch"->>'firstMessage', "owner_user_id");
--> statement-breakpoint
DROP FUNCTION "zetta"."_mention_tokens"(text, text);
--> statement-breakpoint
DROP FUNCTION "zetta"."_mention_plain"(text, text);
--> statement-breakpoint
DROP FUNCTION "zetta"."_mention_token"(text, text, uuid, text);

-- A bot posts only in its own chat or in a room where it is a member. Same rule as `insertMessage` in apps/server; this is the last line.
CREATE OR REPLACE FUNCTION zetta.message_author_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM zetta.conversation c
    WHERE c.id = NEW.conversation_id
      AND (
        (c.kind <> 'discussion' AND c.bot_id = NEW.author_bot_id)
        OR (c.kind = 'discussion' AND EXISTS (
          SELECT 1 FROM zetta.discussion d
          JOIN zetta.discussion_member m ON m.discussion_id = d.id
          WHERE d.conversation_id = c.id AND m.bot_id = NEW.author_bot_id
        ))
      )
  ) THEN
    RAISE EXCEPTION 'bot_post_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER message_author_guard_trg BEFORE INSERT ON zetta.message FOR EACH ROW WHEN (NEW.author_bot_id IS NOT NULL) EXECUTE FUNCTION zetta.message_author_guard();

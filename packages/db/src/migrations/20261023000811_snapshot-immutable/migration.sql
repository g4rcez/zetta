CREATE OR REPLACE FUNCTION snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title OR NEW.bot_name IS DISTINCT FROM OLD.bot_name
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'snapshot content is immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER snapshot_immutable_trg BEFORE UPDATE ON snapshot FOR EACH ROW EXECUTE FUNCTION snapshot_immutable();

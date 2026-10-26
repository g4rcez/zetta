CREATE OR REPLACE FUNCTION snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title OR NEW.bot_name IS DISTINCT FROM OLD.bot_name
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'snapshot content is immutable';
  END IF;
  -- Revocation is one-way: a revoked snapshot can never become visible to the team again.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'snapshot revocation is permanent';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

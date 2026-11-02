-- Custom feature constraints: authored after drizzle-kit generate --custom.
CREATE FUNCTION zetta.runs_guard_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.owner_user_id, NEW.request_key, NEW.origin_kind, NEW.bot_id,
         NEW.conversation_id, NEW.configuration_id, NEW.configuration_version,
         NEW.input_version, NEW.input_snapshot, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.owner_user_id, OLD.request_key, OLD.origin_kind, OLD.bot_id,
         OLD.conversation_id, OLD.configuration_id, OLD.configuration_version,
         OLD.input_version, OLD.input_snapshot, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'runs_identity_immutable', MESSAGE = 'Run identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER runs_identity_immutable BEFORE UPDATE ON zetta.runs
FOR EACH ROW EXECUTE FUNCTION zetta.runs_guard_identity();
--> statement-breakpoint
CREATE FUNCTION zetta.run_attempts_guard_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.run_id, NEW.owner_user_id, NEW.generation, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.run_id, OLD.owner_user_id, OLD.generation, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'run_attempts_identity_immutable', MESSAGE = 'Attempt identity is immutable';
    END IF;
    IF OLD.lease_id IS NOT NULL AND NEW.lease_id IS DISTINCT FROM OLD.lease_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'run_attempts_lease_immutable', MESSAGE = 'Lease identity is immutable';
    END IF;
    IF OLD.lease_expires_at IS NOT NULL AND (NEW.lease_expires_at IS NULL OR NEW.lease_expires_at < OLD.lease_expires_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'run_attempts_expiry_monotonic', MESSAGE = 'Lease expiry cannot move backward';
    END IF;
  END IF;
  -- Serialize deletion with a concurrent pointer change before its deferred check.
  -- Callers lock run then attempt; direct inverted SQL can deadlock and must abort.
  PERFORM 1 FROM zetta.runs WHERE id = OLD.run_id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER run_attempts_write_guard BEFORE UPDATE OR DELETE ON zetta.run_attempts
FOR EACH ROW EXECUTE FUNCTION zetta.run_attempts_guard_write();
--> statement-breakpoint
CREATE FUNCTION zetta.runs_check_current_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_run uuid;
  required_generation integer;
BEGIN
  IF TG_TABLE_NAME = 'runs' THEN
    target_run := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_run := OLD.run_id;
  ELSE
    target_run := NEW.run_id;
  END IF;
  -- Read the current row at deferred execution, never the event's stale pointer.
  SELECT current_generation INTO required_generation FROM zetta.runs WHERE id = target_run FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Lock the matching attempt too: an old repeatable-read snapshot must not accept a deleted tuple.
  PERFORM 1 FROM zetta.run_attempts WHERE run_id = target_run AND generation = required_generation FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'runs_current_attempt_exists', MESSAGE = 'Current attempt is required';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runs_current_attempt_exists AFTER INSERT OR UPDATE ON zetta.runs
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zetta.runs_check_current_attempt();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER run_attempts_current_attempt_exists AFTER INSERT OR UPDATE OR DELETE ON zetta.run_attempts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zetta.runs_check_current_attempt();

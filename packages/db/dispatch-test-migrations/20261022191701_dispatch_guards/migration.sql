-- Custom guard SQL authored after the installed generator created this migration.
CREATE FUNCTION zetta.dispatch_reject_capacity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_capacity_frozen', MESSAGE = 'Dispatch policy is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_capacity_frozen BEFORE UPDATE OR DELETE ON zetta.dispatch_capacity
FOR EACH ROW EXECUTE FUNCTION zetta.dispatch_reject_capacity_change();
--> statement-breakpoint
CREATE TRIGGER dispatch_capacity_no_truncate BEFORE TRUNCATE ON zetta.dispatch_capacity
FOR EACH STATEMENT EXECUTE FUNCTION zetta.dispatch_reject_capacity_change();
--> statement-breakpoint
CREATE FUNCTION zetta.dispatch_retain_tombstones() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_tombstones_retained', MESSAGE = 'Dispatch history is retained';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_claims_no_delete BEFORE DELETE ON zetta.dispatch_claims
FOR EACH ROW EXECUTE FUNCTION zetta.dispatch_retain_tombstones();
--> statement-breakpoint
CREATE TRIGGER dispatch_claims_no_truncate BEFORE TRUNCATE ON zetta.dispatch_claims
FOR EACH STATEMENT EXECUTE FUNCTION zetta.dispatch_retain_tombstones();
--> statement-breakpoint
CREATE TRIGGER dispatch_grants_no_delete BEFORE DELETE ON zetta.dispatch_grants
FOR EACH ROW EXECUTE FUNCTION zetta.dispatch_retain_tombstones();
--> statement-breakpoint
CREATE TRIGGER dispatch_grants_no_truncate BEFORE TRUNCATE ON zetta.dispatch_grants
FOR EACH STATEMENT EXECUTE FUNCTION zetta.dispatch_retain_tombstones();
--> statement-breakpoint
CREATE FUNCTION zetta.dispatch_guard_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF OLD.revision = 2147483647 OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_revision_monotonic', MESSAGE = 'Dispatch revision must advance once';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_claims_revision BEFORE UPDATE ON zetta.dispatch_claims
FOR EACH ROW EXECUTE FUNCTION zetta.dispatch_guard_revision();
--> statement-breakpoint
CREATE TRIGGER dispatch_grants_revision BEFORE UPDATE ON zetta.dispatch_grants
FOR EACH ROW EXECUTE FUNCTION zetta.dispatch_guard_revision();
--> statement-breakpoint
CREATE FUNCTION zetta.dispatch_guard_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.updated_at <> NEW.created_at OR NEW.resource_state <> 'not_submitted'
       OR NEW.receipt_id IS NOT NULL OR NEW.prepare_intent_at IS NOT NULL
       OR NEW.pending_operation_id IS NOT NULL OR NEW.pending_operation_kind IS NOT NULL
       OR NEW.cleanup_kind IS NOT NULL OR NEW.cleanup_confirmed_at IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancel_requested_at IS NOT NULL OR NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_claims_initial', MESSAGE = 'Claim must begin unsubmitted';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.attempt_id, NEW.run_id, NEW.owner_user_id, NEW.generation, NEW.lease_id,
         NEW.claim_operation_id, NEW.launcher_installation_id, NEW.policy_version,
         NEW.launch_spec_version, NEW.launch_spec_canonical, NEW.launch_spec_digest,
         NEW.launch_identity_digest, NEW.image_digest, NEW.deadline_at, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.attempt_id, OLD.run_id, OLD.owner_user_id, OLD.generation, OLD.lease_id,
         OLD.claim_operation_id, OLD.launcher_installation_id, OLD.policy_version,
         OLD.launch_spec_version, OLD.launch_spec_canonical, OLD.launch_spec_digest,
         OLD.launch_identity_digest, OLD.image_digest, OLD.deadline_at, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_claims_identity_immutable', MESSAGE = 'Claim identity is immutable';
  END IF;
  IF (OLD.receipt_id IS NOT NULL AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id)
     OR (OLD.prepare_intent_at IS NOT NULL AND NEW.prepare_intent_at IS DISTINCT FROM OLD.prepare_intent_at)
     OR (OLD.cancel_reason IS NOT NULL AND ROW(NEW.cancel_reason, NEW.cancel_requested_at) IS DISTINCT FROM ROW(OLD.cancel_reason, OLD.cancel_requested_at))
     OR (OLD.cleanup_kind IS NOT NULL AND ROW(NEW.cleanup_kind, NEW.cleanup_confirmed_at) IS DISTINCT FROM ROW(OLD.cleanup_kind, OLD.cleanup_confirmed_at))
     OR (OLD.released_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
     OR (OLD.prepare_intent_at IS NOT NULL AND NEW.resource_state = 'not_submitted')
     OR (OLD.resource_state = 'cleaned' AND NEW.resource_state <> 'cleaned')
     OR ((OLD.cleanup_kind IS NOT NULL OR OLD.released_at IS NOT NULL) AND NEW.pending_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_claims_forward_only', MESSAGE = 'Claim facts cannot regress';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_claims_guard BEFORE INSERT OR UPDATE ON zetta.dispatch_claims
FOR EACH ROW EXECUTE FUNCTION zetta.dispatch_guard_claim();
--> statement-breakpoint
CREATE FUNCTION zetta.dispatch_guard_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.updated_at <> NEW.created_at OR NEW.state <> 'pending'
       OR NEW.delivery_outcome <> 'not_attempted' OR NEW.issued_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_grants_initial', MESSAGE = 'Grant must begin pending';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.attempt_id, NEW.run_id, NEW.owner_user_id, NEW.action_id, NEW.kind, NEW.sequence,
         NEW.canonical_action, NEW.action_digest, NEW.connection_id, NEW.credential_version, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.attempt_id, OLD.run_id, OLD.owner_user_id, OLD.action_id, OLD.kind, OLD.sequence,
         OLD.canonical_action, OLD.action_digest, OLD.connection_id, OLD.credential_version, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_grants_identity_immutable', MESSAGE = 'Grant identity is immutable';
  END IF;
  IF (OLD.state = 'pending' AND NEW.state = 'pending' AND NEW IS DISTINCT FROM OLD)
     OR (OLD.state = 'pending' AND NEW.state NOT IN ('pending','issued','cancelled','expired','uncertain'))
     OR (OLD.state = 'issued' AND NEW.state NOT IN ('issued','uncertain'))
     OR (OLD.state = 'uncertain' AND NEW.state <> 'uncertain')
     OR (OLD.state IN ('cancelled','expired') AND NEW IS DISTINCT FROM OLD)
     OR (OLD.delivery_outcome = 'acknowledged' AND NEW.delivery_outcome <> 'acknowledged')
     OR (OLD.delivery_outcome = 'unknown' AND NEW.delivery_outcome NOT IN ('unknown','acknowledged'))
     OR (OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at)
     OR (OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL AND NOT (OLD.state = 'pending' AND NEW.state = 'issued'))
     OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'dispatch_grants_forward_only', MESSAGE = 'Grant admission cannot regress';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_grants_guard BEFORE INSERT OR UPDATE ON zetta.dispatch_grants
FOR EACH ROW EXECUTE FUNCTION zetta.dispatch_guard_grant();

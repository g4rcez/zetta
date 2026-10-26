CREATE FUNCTION public.membership_guard_activation_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.activation_revision IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'membership_activation_initial', MESSAGE = 'Membership activation denied.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'membership_activation_identity_immutable', MESSAGE = 'Membership activation denied.';
  END IF;
  IF OLD.status = 'removed' AND NEW.status = 'active' THEN
    IF OLD.activation_revision = 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'membership_activation_exhausted', MESSAGE = 'Membership activation denied.';
    END IF;
    IF NEW.activation_revision IS DISTINCT FROM OLD.activation_revision + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'membership_activation_transition', MESSAGE = 'Membership activation denied.';
    END IF;
  ELSIF NEW.activation_revision IS DISTINCT FROM OLD.activation_revision THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'membership_activation_transition', MESSAGE = 'Membership activation denied.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER membership_activation_revision_guard
BEFORE INSERT OR UPDATE ON public.membership
FOR EACH ROW EXECUTE FUNCTION public.membership_guard_activation_revision();

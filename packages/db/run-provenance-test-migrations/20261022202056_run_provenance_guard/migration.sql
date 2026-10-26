CREATE FUNCTION public.runs_guard_producer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.producer_kind IS DISTINCT FROM OLD.producer_kind
     OR NEW.producer_version IS DISTINCT FROM OLD.producer_version
     OR NEW.actor_activation_revision IS DISTINCT FROM OLD.actor_activation_revision THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'runs_producer_immutable', MESSAGE = 'Run producer provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER runs_producer_immutable BEFORE UPDATE ON public.runs
FOR EACH ROW EXECUTE FUNCTION public.runs_guard_producer();

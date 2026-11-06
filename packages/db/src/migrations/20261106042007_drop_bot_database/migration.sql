-- The bot database plugin is removed: bots keep what they need in memory. Each bot had a private schema and a LOGIN role (`<slug>_bot`).
-- Nothing is lost: a schema with no rows is dropped with its role; a schema that holds rows is kept, its role can no longer log in, and a
-- NOTICE names it so an administrator can export it (pg_dump --schema=<name>) and drop it later. This block creates no function or trigger.
DO $$
DECLARE
  r record;
  t record;
  n bigint;
  total bigint;
BEGIN
  FOR r IN SELECT schema_name, role_name FROM "zetta"."bot_database" ORDER BY created_at LOOP
    -- Only names the plugin itself generated are touched; anything else is left alone.
    IF r.schema_name !~ '^[a-z][a-z0-9_]{0,58}_bot$' OR r.schema_name LIKE 'pg\_%' OR r.role_name IS DISTINCT FROM r.schema_name THEN
      RAISE NOTICE 'bot database %: unexpected name, left untouched', r.schema_name;
      CONTINUE;
    END IF;
    total := 0;
    FOR t IN
      SELECT c.relname
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = r.schema_name AND c.relkind IN ('r', 'p', 'm')
    LOOP
      EXECUTE format('SELECT count(*) FROM %I.%I', r.schema_name, t.relname) INTO n;
      total := total + n;
    END LOOP;
    PERFORM pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = r.role_name AND pid <> pg_backend_pid();
    IF total = 0 THEN
      EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.schema_name);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role_name) THEN
        EXECUTE format('DROP OWNED BY %I', r.role_name);
        EXECUTE format('DROP ROLE %I', r.role_name);
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role_name) THEN
        EXECUTE format('ALTER ROLE %I NOLOGIN', r.role_name);
      END IF;
      RAISE NOTICE 'bot database kept: schema % holds % row(s); export it with pg_dump --schema=% and drop it when done', r.schema_name, total, r.schema_name;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
DROP TABLE "zetta"."bot_database";

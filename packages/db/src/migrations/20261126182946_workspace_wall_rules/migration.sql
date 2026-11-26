-- The wall between workspaces (docs/decisions/workspaces.md, "RLS"). The app runs every query as `zetta_app`: the pool switches to it on
-- each connection (packages/db/src/index.ts), so the rules below hold also where the login is a superuser (a local install, the tests).
-- A superuser or the owner that runs migrations is not held by them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zetta_app') THEN
    CREATE ROLE zetta_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint
-- The login that runs migrations is the one the app connects with: it may switch to the role.
GRANT zetta_app TO current_user;
--> statement-breakpoint
GRANT USAGE ON SCHEMA zetta TO zetta_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA zetta TO zetta_app;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA zetta TO zetta_app;
--> statement-breakpoint
-- pgvector's functions and operators live in the schema too.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA zetta TO zetta_app;
--> statement-breakpoint
-- Tables of later migrations, made by the same login, get the same rights.
ALTER DEFAULT PRIVILEGES IN SCHEMA zetta GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zetta_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA zetta GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO zetta_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA zetta GRANT EXECUTE ON FUNCTIONS TO zetta_app;
--> statement-breakpoint
-- The server reads which migrations ran.
GRANT USAGE ON SCHEMA drizzle TO zetta_app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO zetta_app;
--> statement-breakpoint
-- One rule on every table of a workspace: a row is seen and written only by work set to its workspace. No setting, or a setting that is not
-- a workspace id, matches no row. `FORCE` holds the tables' owner to it as well.
--> statement-breakpoint
ALTER TABLE "zetta"."agenda_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."agenda_item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."agenda_item" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."agenda_sync" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."agenda_sync" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."agenda_sync" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."app" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."app" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."app" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."app_call" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."app_call" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."app_record" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."app_record" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."app_record" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."app_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."app_version" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."app_version" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."approval_rule" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."approval_rule" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."approval_rule" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."artifact" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."artifact" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."artifact" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."attachment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."attachment" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."attachment" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."attention_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."attention_item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."attention_item" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."audit_event" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_app" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_app" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_app" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_asset" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_asset" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_claude_asset" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_config" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_config" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_claude_config" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_connection" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_connection" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_connection" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_prompt" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_prompt" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_drive_prompt" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_drive_run" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_engine" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_integration" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_integration" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_integration" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_lesson" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_lesson_event" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_lesson_evidence" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_peer" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_peer" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_peer" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_revision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_revision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_revision" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."bot_skill" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."bot_skill" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."bot_skill" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."browser_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."browser_profile" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."browser_profile" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."chat_queue" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."chat_queue" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."chat_queue" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."chief_share" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."computer_vm" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."config_proposal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."config_proposal" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."config_proposal" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."connection" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."connection" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."connection" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."connection_credential" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."connection_credential" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."connection_credential" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."connection_mutation_receipt" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."connection_mutation_receipt" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."connection_mutation_receipt" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."conversation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."conversation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."conversation" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."conversation_summary" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."decision_config" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."decision_config" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."decision_config" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."delegation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."delegation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."delegation" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."device" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."device" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."device" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."device_bot" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."device_bot" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."device_bot" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."discussion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."discussion" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."discussion_member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."discussion_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."discussion_member" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."discussion_turn" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."discussion_turn" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."discussion_turn" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."engine_account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."engine_account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."engine_account" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."folder" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."folder" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."folder" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."goal_loop" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."goal_loop" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."goal_loop" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."hook" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."hook" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."hook" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."inbound_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."inbound_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."inbound_event" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."inbound_route" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."inbound_route" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."inbound_route" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."inbound_thread" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."inbound_thread" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."inbound_thread" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."item_use" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."item_use" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."item_use" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_doc" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_doc" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."knowledge_doc" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_source" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_source" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."knowledge_source" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."learning_finding" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."learning_finding" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."learning_finding" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."learning_policy" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."learning_policy" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."learning_policy" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."learning_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."learning_run" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."learning_run" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."machine" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."machine" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."machine" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."machine_bot" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."machine_bot" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."machine_bot" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."mailbox" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."mailbox_message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."mailbox_message" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."mailbox_message" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."mcp_server" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."mcp_server" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."mcp_server" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_chunk" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_item" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_project" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_project" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_item_project" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_item_team" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_job" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_link" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_link" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_link" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_raw" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_revision" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_source" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."memory_suggestion" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."message" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."message" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."message_feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."message_feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."message_feedback" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."message_pin" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."message_revision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."message_revision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."message_revision" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."org_chart" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."org_chart" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."org_chart" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."org_position" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."org_position" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."output_style" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."output_style" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."output_style" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."phone_number" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."phone_number" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."phone_number" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."playground" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."playground" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."playground" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."playground_file" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."playground_file" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."playground_file" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."playground_run" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."playground_run_output" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."playground_run_output" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."playground_run_output" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."poll_vote" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."project" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."project" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."project" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."project_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."project_member" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."reaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."reaction" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."reaction" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."reply_outcome" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."routine" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."routine" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."routine" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."routine_run" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."routine_trigger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."routine_trigger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."routine_trigger" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."skill" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."skill" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."skill" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."skill_file" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."skill_file" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."skill_file" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."skill_review" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."skill_review" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."skill_review" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."skill_revision" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."skill_use" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."skill_use" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."skill_use" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."snapshot" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."snapshot" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."snapshot" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."source" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."source" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."source" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."task" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."task" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."task" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."team" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."team" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."team" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."team_member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."team_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."team_member" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."team_person" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."team_person" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."team_person" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."team_role" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."team_role" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."team_role" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."turn_step" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."turn_step" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."turn_step" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."voice_call" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."work_watch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."work_watch" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."work_watch" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."workflow" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."workflow" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."workflow" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."workflow_run" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
ALTER TABLE "zetta"."workflow_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zetta"."workflow_version" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_wall" ON "zetta"."workflow_version" USING ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end)) WITH CHECK ("workspace_id" = (case when current_setting('app.workspace_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then current_setting('app.workspace_id', true)::uuid end));
--> statement-breakpoint
-- What arrives from outside with no person signed in (a call, a message to a channel, a device, a webhook trigger) is routed by reading
-- these tables across workspaces, and only reading: `tenant.scan` in packages/db/src/tenant.ts. The work it starts runs in the row's own
-- workspace.
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."computer_vm" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."device" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."device_bot" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."inbound_route" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."inbound_thread" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."machine" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."mailbox" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."phone_number" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."routine_trigger" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');
--> statement-breakpoint
CREATE POLICY "workspace_scan" ON "zetta"."voice_call" FOR SELECT USING (current_setting('app.workspace_id', true) = '*');

CREATE SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "account" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "jwks" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "oauth_access_token" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "oauth_client" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "oauth_client_assertion" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "oauth_client_resource" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "oauth_consent" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "oauth_resource" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "session" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "user" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "verification" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "identity_audit" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "installation_identity" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "invitation" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "membership" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "connection" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "connection_credential" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "connection_key_check" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "connection_mutation_receipt" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "connection_nonce" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "connection_user_key" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "run_attempts" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "runs" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "dispatch_capacity" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "dispatch_claims" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "dispatch_grants" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "output_style" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot_revision" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "chat_queue" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "conversation" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "goal_loop" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "message" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "workspace" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "attachment" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "attention_item" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "audit_event" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot_connection" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot_integration" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "browser_profile" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "computer_vm" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "config_proposal" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "decision_config" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "delegation" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "hook" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "mcp_server" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "reaction" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "routine" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "routine_run" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "snapshot" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "source" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "workflow" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "workflow_run" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "workflow_version" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "agenda_item" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "agenda_sync" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "team" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "team_member" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "team_role" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot_peer" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "discussion" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "discussion_member" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "discussion_turn" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "turn_step" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "inbound_event" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "inbound_route" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "inbound_thread" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot_database" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot_claude_asset" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "bot_claude_config" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "task" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "artifact" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "installation_settings" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "knowledge_doc" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "knowledge_source" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_chunk" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_job" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_link" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_page" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_page_team" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_revision" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_source" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "wiki_suggestion" SET SCHEMA "zetta";
--> statement-breakpoint
ALTER TABLE "user_preference" SET SCHEMA "zetta";
--> statement-breakpoint
-- Bot roles (one LOGIN role per bot) must reach nothing of the app: zetta grants nothing to PUBLIC (same invariant as 20261026224850_bot-database).
REVOKE ALL ON SCHEMA "zetta" FROM PUBLIC;--> statement-breakpoint
-- Extensions and app functions follow the tables. Indexes and the snapshot trigger bind to function OIDs, so they keep working.
ALTER EXTENSION unaccent SET SCHEMA "zetta";--> statement-breakpoint
ALTER EXTENSION vector SET SCHEMA "zetta";--> statement-breakpoint
ALTER FUNCTION public.f_unaccent(text) SET SCHEMA "zetta";--> statement-breakpoint
ALTER FUNCTION public.snapshot_immutable() SET SCHEMA "zetta";--> statement-breakpoint
-- The SQL body is stored as text and still names public.unaccent: rewrite it. Same result, same OID.
CREATE OR REPLACE FUNCTION zetta.f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT zetta.unaccent('zetta.unaccent', $1) $$;--> statement-breakpoint
-- Migrations that run after this one in the same transaction use bare vector / f_unaccent.
SET LOCAL search_path TO "zetta";--> statement-breakpoint
-- psql, drizzle-kit and other tools: every new connection to this database resolves bare names in zetta.
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path TO zetta', current_database()); END $$;

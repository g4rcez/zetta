-- Every database has a workspace from here on: a fresh one gets the first now, and the first account becomes its owner.
INSERT INTO "zetta"."workspace" ("slug", "name")
SELECT 'main', 'Workspace' WHERE NOT EXISTS (SELECT 1 FROM "zetta"."workspace");
--> statement-breakpoint
-- The rows that exist belong to the first workspace: there could be no other before this migration. The column default reads this
-- setting, so each table below is filled as its column is added, with one stored value and no rewrite of the table.
SELECT set_config('app.workspace_id', (SELECT "id"::text FROM "zetta"."workspace" ORDER BY "created_at", "id" LIMIT 1), false);
--> statement-breakpoint
ALTER TABLE "zetta"."agenda_sync" DROP CONSTRAINT "agenda_sync_owner_user_id_key";--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid);--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."engine_account" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."connection" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."connection_credential" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."connection_mutation_receipt" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."output_style" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_revision" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."chat_queue" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."conversation" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."folder" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."goal_loop" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."message" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."message_revision" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."approval_rule" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."attachment" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."attention_item" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_connection" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_prompt" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_integration" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."browser_profile" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."config_proposal" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."decision_config" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."delegation" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."hook" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."machine" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."machine_bot" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."mcp_server" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."message_feedback" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."reaction" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."routine" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."routine_trigger" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."snapshot" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."source" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."workflow" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_version" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."agenda_item" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."agenda_sync" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."team" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."team_member" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."team_person" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."team_role" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_peer" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."discussion_member" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."discussion_turn" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."turn_step" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."inbound_event" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."inbound_route" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."inbound_thread" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_asset" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_config" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_skill" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."skill" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."skill_file" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."skill_review" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."skill_use" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."playground" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."playground_file" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run_output" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."app" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."app_record" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."app_version" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_app" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."project" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."org_chart" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."work_watch" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."artifact" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_doc" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_source" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_event" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."item_use" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."learning_finding" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."learning_policy" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid);--> statement-breakpoint
ALTER TABLE "zetta"."learning_run" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_project" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_link" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."device" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."device_bot" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox_message" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."phone_number" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD COLUMN "workspace_id" uuid DEFAULT cast(nullif(current_setting('app.workspace_id', true), '') as uuid) NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" DROP CONSTRAINT "chief_share_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ADD CONSTRAINT "chief_share_pkey" PRIMARY KEY("workspace_id","user_id");--> statement-breakpoint
ALTER TABLE "zetta"."learning_policy" DROP CONSTRAINT "learning_policy_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."learning_policy" ADD CONSTRAINT "learning_policy_pkey" PRIMARY KEY("workspace_id","owner_user_id");--> statement-breakpoint
DROP INDEX "zetta"."engine_account_one_default";--> statement-breakpoint
CREATE UNIQUE INDEX "engine_account_one_default" ON "zetta"."engine_account" ("workspace_id","owner_user_id","engine") WHERE "use" = 'default' and "state" = 'active';--> statement-breakpoint
DROP INDEX "zetta"."bot_one_chief_per_owner";--> statement-breakpoint
CREATE UNIQUE INDEX "bot_one_chief_per_owner" ON "zetta"."bot" ("workspace_id","owner_user_id") WHERE "kind" = 'chief';--> statement-breakpoint
DROP INDEX "zetta"."bot_slug_key";--> statement-breakpoint
CREATE UNIQUE INDEX "bot_slug_key" ON "zetta"."bot" ("workspace_id","slug");--> statement-breakpoint
DROP INDEX "zetta"."attention_live_source";--> statement-breakpoint
CREATE UNIQUE INDEX "attention_live_source" ON "zetta"."attention_item" ("workspace_id","owner_user_id","source_key") WHERE "source_key" is not null and "status" in ('open', 'acknowledged');--> statement-breakpoint
DROP INDEX "zetta"."computer_vm_default_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "computer_vm_default_unique" ON "zetta"."computer_vm" ("workspace_id","owner_user_id") WHERE "kind" = 'default' and "status" <> 'deleted';--> statement-breakpoint
DROP INDEX "zetta"."computer_vm_local_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "computer_vm_local_unique" ON "zetta"."computer_vm" ("workspace_id","owner_user_id") WHERE "target" = 'local' and "status" <> 'deleted';--> statement-breakpoint
DROP INDEX "zetta"."machine_owner_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "machine_owner_name_unique" ON "zetta"."machine" ("workspace_id","owner_user_id","name") WHERE "deleted_at" is null;--> statement-breakpoint
DROP INDEX "zetta"."mcp_server_team_name";--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_team_name" ON "zetta"."mcp_server" ("workspace_id","name") WHERE "sharing" = 'team';--> statement-breakpoint
DROP INDEX "zetta"."snapshot_request";--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_request" ON "zetta"."snapshot" ("workspace_id","owner_user_id","request_key") WHERE "request_key" is not null;--> statement-breakpoint
DROP INDEX "zetta"."agenda_owner_google_event";--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_owner_google_event" ON "zetta"."agenda_item" ("workspace_id","owner_user_id","google_account","google_event_id") WHERE "google_event_id" is not null;--> statement-breakpoint
DROP INDEX "zetta"."team_owner_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "team_owner_name_unique" ON "zetta"."team" ("workspace_id","owner_user_id",lower("name")) WHERE "status" = 'active';--> statement-breakpoint
DROP INDEX "zetta"."team_role_owner_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "team_role_owner_name_unique" ON "zetta"."team_role" ("workspace_id","owner_user_id",lower("name"));--> statement-breakpoint
DROP INDEX "zetta"."discussion_room_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_room_name_unique" ON "zetta"."discussion" ("workspace_id","owner_user_id",lower("title")) WHERE "team_id" is not null and "status" in ('open', 'paused', 'stalled');--> statement-breakpoint
DROP INDEX "zetta"."discussion_open_key";--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_open_key" ON "zetta"."discussion" ("workspace_id","owner_user_id","open_key") WHERE "status" in ('open', 'paused', 'stalled');--> statement-breakpoint
DROP INDEX "zetta"."inbound_route_owner_plugin_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_route_owner_plugin_unique" ON "zetta"."inbound_route" ("workspace_id","owner_user_id","plugin_id") WHERE "mailbox_id" is null;--> statement-breakpoint
DROP INDEX "zetta"."skill_owner_name_active";--> statement-breakpoint
CREATE UNIQUE INDEX "skill_owner_name_active" ON "zetta"."skill" ("workspace_id","owner_user_id","name") WHERE "status" = 'active';--> statement-breakpoint
DROP INDEX "zetta"."app_owner_slug_active_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "app_owner_slug_active_idx" ON "zetta"."app" ("workspace_id","owner_user_id","slug") WHERE "status" = 'active';--> statement-breakpoint
DROP INDEX "zetta"."project_owner_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "project_owner_name_unique" ON "zetta"."project" ("workspace_id","owner_user_id",lower("name")) WHERE "status" <> 'archived';--> statement-breakpoint
DROP INDEX "zetta"."learning_finding_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "learning_finding_unique" ON "zetta"."learning_finding" ("workspace_id","owner_user_id","kind","ref_hash");--> statement-breakpoint
DROP INDEX "zetta"."memory_item_shared_slug";--> statement-breakpoint
CREATE UNIQUE INDEX "memory_item_shared_slug" ON "zetta"."memory_item" ("workspace_id","slug") WHERE "type" = 'all';--> statement-breakpoint
DROP INDEX "zetta"."device_owner_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "device_owner_name_unique" ON "zetta"."device" ("workspace_id","owner_user_id","name") WHERE "revoked_at" is null;--> statement-breakpoint
DROP INDEX "zetta"."mailbox_owner_kind_address_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_owner_kind_address_unique" ON "zetta"."mailbox" ("workspace_id","owner_user_id","kind",lower("address"));--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."message" ADD CONSTRAINT "message_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."workflow" ADD CONSTRAINT "workflow_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."agenda_sync" ADD CONSTRAINT "agenda_sync_workspace_owner_unique" UNIQUE("workspace_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "zetta"."team" ADD CONSTRAINT "team_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD CONSTRAINT "discussion_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."skill" ADD CONSTRAINT "skill_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."playground" ADD CONSTRAINT "playground_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ADD CONSTRAINT "playground_run_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."app" ADD CONSTRAINT "app_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."project" ADD CONSTRAINT "project_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."org_chart" ADD CONSTRAINT "org_chart_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."org_chart" ADD CONSTRAINT "org_chart_one_per_workspace" UNIQUE("workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD CONSTRAINT "task_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ADD CONSTRAINT "bot_lesson_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" ADD CONSTRAINT "memory_item_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD CONSTRAINT "mailbox_id_workspace_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "zetta"."folder" DROP CONSTRAINT "folder_owner_name_unique";--> statement-breakpoint
ALTER TABLE "zetta"."folder" ADD CONSTRAINT "folder_owner_name_unique" UNIQUE("workspace_id","owner_user_id","name");--> statement-breakpoint
ALTER TABLE "zetta"."browser_profile" DROP CONSTRAINT "browser_profile_unique";--> statement-breakpoint
ALTER TABLE "zetta"."browser_profile" ADD CONSTRAINT "browser_profile_unique" UNIQUE("workspace_id","owner_user_id","name");--> statement-breakpoint
ALTER TABLE "zetta"."mcp_server" DROP CONSTRAINT "mcp_server_owner_name";--> statement-breakpoint
ALTER TABLE "zetta"."mcp_server" ADD CONSTRAINT "mcp_server_owner_name" UNIQUE("workspace_id","owner_user_id","name","sharing");--> statement-breakpoint
ALTER TABLE "zetta"."source" DROP CONSTRAINT "source_owner_url";--> statement-breakpoint
ALTER TABLE "zetta"."source" ADD CONSTRAINT "source_owner_url" UNIQUE("workspace_id","owner_user_id","url");--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_source" DROP CONSTRAINT "knowledge_source_owner_provider";--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_source" ADD CONSTRAINT "knowledge_source_owner_provider" UNIQUE NULLS NOT DISTINCT("workspace_id","owner_user_id","provider","account");--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" DROP CONSTRAINT "memory_item_owner_slug";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" ADD CONSTRAINT "memory_item_owner_slug" UNIQUE("workspace_id","owner_user_id","slug");--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" DROP CONSTRAINT "memory_raw_owner_sha";--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" ADD CONSTRAINT "memory_raw_owner_sha" UNIQUE("workspace_id","owner_user_id","sha256");--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ADD CONSTRAINT "chief_share_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ADD CONSTRAINT "chief_share_bot_id_workspace_fkey" FOREIGN KEY ("bot_id","workspace_id") REFERENCES "zetta"."bot"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" ADD CONSTRAINT "bot_engine_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" ADD CONSTRAINT "bot_engine_bot_id_workspace_fkey" FOREIGN KEY ("bot_id","workspace_id") REFERENCES "zetta"."bot"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."engine_account" ADD CONSTRAINT "engine_account_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection" ADD CONSTRAINT "connection_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection_credential" ADD CONSTRAINT "connection_credential_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection_mutation_receipt" ADD CONSTRAINT "connection_mutation_receipt_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."output_style" ADD CONSTRAINT "output_style_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
-- bot_folder_id_folder_id_fkey exists already: the folder rename renamed it, and the snapshot before this one kept its old name.
ALTER TABLE "zetta"."bot_revision" ADD CONSTRAINT "bot_revision_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_revision" ADD CONSTRAINT "bot_revision_bot_id_workspace_fkey" FOREIGN KEY ("bot_id","workspace_id") REFERENCES "zetta"."bot"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."chat_queue" ADD CONSTRAINT "chat_queue_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."conversation" ADD CONSTRAINT "conversation_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" ADD CONSTRAINT "conversation_summary_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."folder" ADD CONSTRAINT "folder_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."goal_loop" ADD CONSTRAINT "goal_loop_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message" ADD CONSTRAINT "message_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_revision" ADD CONSTRAINT "message_revision_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_revision" ADD CONSTRAINT "message_revision_message_id_workspace_fkey" FOREIGN KEY ("message_id","workspace_id") REFERENCES "zetta"."message"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."approval_rule" ADD CONSTRAINT "approval_rule_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."attachment" ADD CONSTRAINT "attachment_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."attention_item" ADD CONSTRAINT "attention_item_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD CONSTRAINT "audit_event_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_connection" ADD CONSTRAINT "bot_connection_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_prompt" ADD CONSTRAINT "bot_drive_prompt_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD CONSTRAINT "bot_drive_run_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_integration" ADD CONSTRAINT "bot_integration_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."browser_profile" ADD CONSTRAINT "browser_profile_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD CONSTRAINT "computer_vm_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."config_proposal" ADD CONSTRAINT "config_proposal_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."decision_config" ADD CONSTRAINT "decision_config_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."delegation" ADD CONSTRAINT "delegation_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."hook" ADD CONSTRAINT "hook_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."machine" ADD CONSTRAINT "machine_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."machine_bot" ADD CONSTRAINT "machine_bot_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mcp_server" ADD CONSTRAINT "mcp_server_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_feedback" ADD CONSTRAINT "message_feedback_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" ADD CONSTRAINT "message_pin_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" ADD CONSTRAINT "message_pin_message_id_workspace_fkey" FOREIGN KEY ("message_id","workspace_id") REFERENCES "zetta"."message"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" ADD CONSTRAINT "poll_vote_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" ADD CONSTRAINT "poll_vote_message_id_workspace_fkey" FOREIGN KEY ("message_id","workspace_id") REFERENCES "zetta"."message"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."reaction" ADD CONSTRAINT "reaction_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."routine" ADD CONSTRAINT "routine_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" ADD CONSTRAINT "routine_run_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."routine_trigger" ADD CONSTRAINT "routine_trigger_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."snapshot" ADD CONSTRAINT "snapshot_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."source" ADD CONSTRAINT "source_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."workflow" ADD CONSTRAINT "workflow_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ADD CONSTRAINT "workflow_run_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_version" ADD CONSTRAINT "workflow_version_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_version" ADD CONSTRAINT "workflow_version_workflow_id_workspace_fkey" FOREIGN KEY ("workflow_id","workspace_id") REFERENCES "zetta"."workflow"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."agenda_item" ADD CONSTRAINT "agenda_item_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."agenda_sync" ADD CONSTRAINT "agenda_sync_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."team" ADD CONSTRAINT "team_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."team_member" ADD CONSTRAINT "team_member_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."team_member" ADD CONSTRAINT "team_member_team_id_workspace_fkey" FOREIGN KEY ("team_id","workspace_id") REFERENCES "zetta"."team"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."team_person" ADD CONSTRAINT "team_person_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."team_person" ADD CONSTRAINT "team_person_team_id_workspace_fkey" FOREIGN KEY ("team_id","workspace_id") REFERENCES "zetta"."team"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."team_role" ADD CONSTRAINT "team_role_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_peer" ADD CONSTRAINT "bot_peer_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD CONSTRAINT "discussion_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."discussion_member" ADD CONSTRAINT "discussion_member_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."discussion_member" ADD CONSTRAINT "discussion_member_discussion_id_workspace_fkey" FOREIGN KEY ("discussion_id","workspace_id") REFERENCES "zetta"."discussion"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."discussion_turn" ADD CONSTRAINT "discussion_turn_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."turn_step" ADD CONSTRAINT "turn_step_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."inbound_event" ADD CONSTRAINT "inbound_event_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."inbound_route" ADD CONSTRAINT "inbound_route_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."inbound_thread" ADD CONSTRAINT "inbound_thread_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_asset" ADD CONSTRAINT "bot_claude_asset_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_asset" ADD CONSTRAINT "bot_claude_asset_bot_id_workspace_fkey" FOREIGN KEY ("bot_id","workspace_id") REFERENCES "zetta"."bot"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_config" ADD CONSTRAINT "bot_claude_config_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_claude_config" ADD CONSTRAINT "bot_claude_config_bot_id_workspace_fkey" FOREIGN KEY ("bot_id","workspace_id") REFERENCES "zetta"."bot"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_skill" ADD CONSTRAINT "bot_skill_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_skill" ADD CONSTRAINT "bot_skill_bot_id_workspace_fkey" FOREIGN KEY ("bot_id","workspace_id") REFERENCES "zetta"."bot"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill" ADD CONSTRAINT "skill_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_file" ADD CONSTRAINT "skill_file_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_file" ADD CONSTRAINT "skill_file_skill_id_workspace_fkey" FOREIGN KEY ("skill_id","workspace_id") REFERENCES "zetta"."skill"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_review" ADD CONSTRAINT "skill_review_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" ADD CONSTRAINT "skill_revision_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" ADD CONSTRAINT "skill_revision_skill_id_workspace_fkey" FOREIGN KEY ("skill_id","workspace_id") REFERENCES "zetta"."skill"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_use" ADD CONSTRAINT "skill_use_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_use" ADD CONSTRAINT "skill_use_skill_id_workspace_fkey" FOREIGN KEY ("skill_id","workspace_id") REFERENCES "zetta"."skill"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground" ADD CONSTRAINT "playground_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_file" ADD CONSTRAINT "playground_file_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_file" ADD CONSTRAINT "playground_file_playground_id_workspace_fkey" FOREIGN KEY ("playground_id","workspace_id") REFERENCES "zetta"."playground"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ADD CONSTRAINT "playground_run_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ADD CONSTRAINT "playground_run_playground_id_workspace_fkey" FOREIGN KEY ("playground_id","workspace_id") REFERENCES "zetta"."playground"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run_output" ADD CONSTRAINT "playground_run_output_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run_output" ADD CONSTRAINT "playground_run_output_run_id_workspace_fkey" FOREIGN KEY ("run_id","workspace_id") REFERENCES "zetta"."playground_run"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app" ADD CONSTRAINT "app_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_app_id_workspace_fkey" FOREIGN KEY ("app_id","workspace_id") REFERENCES "zetta"."app"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_record" ADD CONSTRAINT "app_record_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_record" ADD CONSTRAINT "app_record_app_id_workspace_fkey" FOREIGN KEY ("app_id","workspace_id") REFERENCES "zetta"."app"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_version" ADD CONSTRAINT "app_version_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_version" ADD CONSTRAINT "app_version_app_id_workspace_fkey" FOREIGN KEY ("app_id","workspace_id") REFERENCES "zetta"."app"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_app" ADD CONSTRAINT "bot_app_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_app" ADD CONSTRAINT "bot_app_bot_id_workspace_fkey" FOREIGN KEY ("bot_id","workspace_id") REFERENCES "zetta"."bot"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project" ADD CONSTRAINT "project_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ADD CONSTRAINT "project_member_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ADD CONSTRAINT "project_member_project_id_workspace_fkey" FOREIGN KEY ("project_id","workspace_id") REFERENCES "zetta"."project"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_chart" ADD CONSTRAINT "org_chart_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD CONSTRAINT "org_position_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD CONSTRAINT "org_position_chart_id_workspace_fkey" FOREIGN KEY ("chart_id","workspace_id") REFERENCES "zetta"."org_chart"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD CONSTRAINT "task_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."work_watch" ADD CONSTRAINT "work_watch_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."work_watch" ADD CONSTRAINT "work_watch_task_id_workspace_fkey" FOREIGN KEY ("task_id","workspace_id") REFERENCES "zetta"."task"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."artifact" ADD CONSTRAINT "artifact_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_doc" ADD CONSTRAINT "knowledge_doc_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_source" ADD CONSTRAINT "knowledge_source_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ADD CONSTRAINT "bot_lesson_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_event" ADD CONSTRAINT "bot_lesson_event_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_event" ADD CONSTRAINT "bot_lesson_event_lesson_id_workspace_fkey" FOREIGN KEY ("lesson_id","workspace_id") REFERENCES "zetta"."bot_lesson"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" ADD CONSTRAINT "bot_lesson_evidence_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" ADD CONSTRAINT "bot_lesson_evidence_lesson_id_workspace_fkey" FOREIGN KEY ("lesson_id","workspace_id") REFERENCES "zetta"."bot_lesson"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."item_use" ADD CONSTRAINT "item_use_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."learning_finding" ADD CONSTRAINT "learning_finding_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."learning_policy" ADD CONSTRAINT "learning_policy_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."learning_run" ADD CONSTRAINT "learning_run_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" ADD CONSTRAINT "reply_outcome_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" ADD CONSTRAINT "memory_chunk_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" ADD CONSTRAINT "memory_item_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_project" ADD CONSTRAINT "memory_item_project_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_project" ADD CONSTRAINT "memory_item_project_page_id_workspace_fkey" FOREIGN KEY ("page_id","workspace_id") REFERENCES "zetta"."memory_item"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" ADD CONSTRAINT "memory_item_team_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" ADD CONSTRAINT "memory_item_team_page_id_workspace_fkey" FOREIGN KEY ("page_id","workspace_id") REFERENCES "zetta"."memory_item"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" ADD CONSTRAINT "memory_job_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_link" ADD CONSTRAINT "memory_link_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_link" ADD CONSTRAINT "memory_link_from_page_id_workspace_fkey" FOREIGN KEY ("from_page_id","workspace_id") REFERENCES "zetta"."memory_item"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" ADD CONSTRAINT "memory_raw_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" ADD CONSTRAINT "memory_revision_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" ADD CONSTRAINT "memory_source_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" ADD CONSTRAINT "memory_suggestion_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" ADD CONSTRAINT "memory_suggestion_page_id_workspace_fkey" FOREIGN KEY ("page_id","workspace_id") REFERENCES "zetta"."memory_item"("id","workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."device" ADD CONSTRAINT "device_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."device_bot" ADD CONSTRAINT "device_bot_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD CONSTRAINT "mailbox_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox_message" ADD CONSTRAINT "mailbox_message_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox_message" ADD CONSTRAINT "mailbox_message_mailbox_id_workspace_fkey" FOREIGN KEY ("mailbox_id","workspace_id") REFERENCES "zetta"."mailbox"("id","workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."phone_number" ADD CONSTRAINT "phone_number_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD CONSTRAINT "voice_call_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
-- What follows this migration in the same run starts with no workspace, as every connection does.
SELECT set_config('app.workspace_id', '', false);

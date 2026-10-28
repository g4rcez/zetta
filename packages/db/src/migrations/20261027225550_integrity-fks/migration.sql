ALTER TABLE "bot_connection" ADD COLUMN "id" uuid DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "bot_integration" ADD COLUMN "id" uuid DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "bot_peer" ADD COLUMN "id" uuid DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "bot_connection" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "bot_integration" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "bot_peer" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "bot_connection" ALTER COLUMN "connection_id" SET DATA TYPE uuid USING "connection_id"::uuid;--> statement-breakpoint
ALTER TABLE "mcp_server" ALTER COLUMN "connection_id" SET DATA TYPE uuid USING "connection_id"::uuid;--> statement-breakpoint
ALTER TABLE "source" ALTER COLUMN "connection_id" SET DATA TYPE uuid USING "connection_id"::uuid;--> statement-breakpoint
CREATE INDEX "message_parent_message_id_idx" ON "message" ("parent_message_id");--> statement-breakpoint
CREATE INDEX "message_author_bot_id_idx" ON "message" ("author_bot_id");--> statement-breakpoint
CREATE INDEX "workspace_parent_id_idx" ON "workspace" ("parent_id");--> statement-breakpoint
CREATE INDEX "bot_connection_connection_id_idx" ON "bot_connection" ("connection_id");--> statement-breakpoint
CREATE INDEX "delegation_result_message_id_idx" ON "delegation" ("result_message_id");--> statement-breakpoint
CREATE INDEX "mcp_server_connection_id_idx" ON "mcp_server" ("connection_id");--> statement-breakpoint
CREATE INDEX "routine_workflow_id_idx" ON "routine" ("workflow_id");--> statement-breakpoint
CREATE INDEX "snapshot_source_conversation_id_idx" ON "snapshot" ("source_conversation_id");--> statement-breakpoint
CREATE INDEX "source_connection_id_idx" ON "source" ("connection_id");--> statement-breakpoint
CREATE INDEX "discussion_turn_trigger_message_id_idx" ON "discussion_turn" ("trigger_message_id");--> statement-breakpoint
CREATE INDEX "discussion_turn_result_message_id_idx" ON "discussion_turn" ("result_message_id");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_parent_message_id_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_bot_id_bot_id_fkey" FOREIGN KEY ("author_bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_parent_id_workspace_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_connection" ADD CONSTRAINT "bot_connection_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_result_message_id_message_id_fkey" FOREIGN KEY ("result_message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connection"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "routine" ADD CONSTRAINT "routine_workflow_id_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_source_conversation_id_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connection"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion_turn" ADD CONSTRAINT "discussion_turn_trigger_message_id_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion_turn" ADD CONSTRAINT "discussion_turn_result_message_id_message_id_fkey" FOREIGN KEY ("result_message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
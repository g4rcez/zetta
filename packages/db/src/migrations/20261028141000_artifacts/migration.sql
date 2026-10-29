CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid,
	"conversation_id" uuid,
	"routine_run_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_title_check" CHECK (length(btrim("title")) between 1 and 200),
	CONSTRAINT "artifact_size_check" CHECK ("size" >= 0)
);
--> statement-breakpoint
CREATE INDEX "artifact_owner_created_idx" ON "artifact" ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "artifact_bot_id_idx" ON "artifact" ("bot_id");--> statement-breakpoint
CREATE INDEX "artifact_conversation_id_idx" ON "artifact" ("conversation_id");--> statement-breakpoint
CREATE INDEX "artifact_routine_run_id_idx" ON "artifact" ("routine_run_id");--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_routine_run_id_routine_run_id_fkey" FOREIGN KEY ("routine_run_id") REFERENCES "routine_run"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
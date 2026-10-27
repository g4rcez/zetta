CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'backlog' NOT NULL,
	"bot_id" uuid,
	"conversation_id" uuid,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "task_owner_idx" ON "task" ("owner_user_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
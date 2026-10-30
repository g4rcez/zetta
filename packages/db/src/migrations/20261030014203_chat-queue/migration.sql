CREATE TABLE "chat_queue" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL CONSTRAINT "chat_queue_message_unique" UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reason_code" text,
	"input" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_queue_conversation_created_idx" ON "chat_queue" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_queue_status_created_idx" ON "chat_queue" ("status","created_at");--> statement-breakpoint
CREATE INDEX "chat_queue_owner_user_id_idx" ON "chat_queue" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "chat_queue" ADD CONSTRAINT "chat_queue_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "chat_queue" ADD CONSTRAINT "chat_queue_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "chat_queue" ADD CONSTRAINT "chat_queue_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
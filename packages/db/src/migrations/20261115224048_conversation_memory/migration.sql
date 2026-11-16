CREATE TABLE "zetta"."conversation_summary" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"thread_root_id" uuid,
	"through_seq" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"wanted_through_seq" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_summary_body_len" CHECK (char_length("body") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "context_bytes" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_summary_unique" ON "zetta"."conversation_summary" ("conversation_id","bot_id",coalesce("thread_root_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "conversation_summary_due_idx" ON "zetta"."conversation_summary" ("status","updated_at");--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" ADD CONSTRAINT "conversation_summary_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" ADD CONSTRAINT "conversation_summary_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" ADD CONSTRAINT "conversation_summary_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" ADD CONSTRAINT "conversation_summary_thread_root_id_message_id_fkey" FOREIGN KEY ("thread_root_id") REFERENCES "zetta"."message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_context_bytes_check" CHECK ("context_bytes" is null or "context_bytes" between 4000 and 60000);
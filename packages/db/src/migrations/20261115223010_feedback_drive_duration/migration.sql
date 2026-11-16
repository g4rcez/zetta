CREATE TABLE "zetta"."bot_drive_prompt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"bot_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_drive_prompt_title_len" CHECK (char_length("title") between 1 and 80),
	CONSTRAINT "bot_drive_prompt_prompt_len" CHECK (char_length("prompt") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "zetta"."bot_drive_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"prompt_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"bot_version" integer NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zetta"."message_feedback" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"message_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"bot_id" uuid,
	"bot_version" integer,
	"rating" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_feedback_unique" UNIQUE("message_id","owner_user_id"),
	CONSTRAINT "message_feedback_reason_len" CHECK (char_length("reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
CREATE INDEX "bot_drive_prompt_bot_idx" ON "zetta"."bot_drive_prompt" ("bot_id","position");--> statement-breakpoint
CREATE INDEX "bot_drive_run_prompt_idx" ON "zetta"."bot_drive_run" ("prompt_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_drive_run_conversation_idx" ON "zetta"."bot_drive_run" ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_feedback_bot_idx" ON "zetta"."message_feedback" ("bot_id","created_at");--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_prompt" ADD CONSTRAINT "bot_drive_prompt_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_prompt" ADD CONSTRAINT "bot_drive_prompt_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD CONSTRAINT "bot_drive_run_prompt_id_bot_drive_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "zetta"."bot_drive_prompt"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD CONSTRAINT "bot_drive_run_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD CONSTRAINT "bot_drive_run_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD CONSTRAINT "bot_drive_run_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD CONSTRAINT "bot_drive_run_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_feedback" ADD CONSTRAINT "message_feedback_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_feedback" ADD CONSTRAINT "message_feedback_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_feedback" ADD CONSTRAINT "message_feedback_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
CREATE TABLE "zetta"."bot_lesson" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"memory_item_id" uuid,
	"skill_id" uuid,
	"text" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'rule' NOT NULL,
	"scope" text DEFAULT 'topic' NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"basis" text,
	"origin" text DEFAULT 'batch' NOT NULL,
	"drop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_lesson_text_check" CHECK (char_length("text") between 1 and 2000),
	CONSTRAINT "bot_lesson_topic_check" CHECK (char_length("topic") <= 60)
);
--> statement-breakpoint
CREATE TABLE "zetta"."bot_lesson_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"lesson_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"by" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_lesson_event_detail_check" CHECK (char_length("detail") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "zetta"."bot_lesson_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"lesson_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"quote" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_lesson_evidence_quote_check" CHECK (char_length("quote") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "zetta"."learning_policy" (
	"owner_user_id" text PRIMARY KEY,
	"batch" text DEFAULT 'daily' NOT NULL,
	"forget" text DEFAULT 'on' NOT NULL,
	"tidy" text DEFAULT 'weekly' NOT NULL,
	"strictness" text DEFAULT 'normal' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zetta"."learning_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text DEFAULT 'batch' NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"candidates" integer DEFAULT 0 NOT NULL,
	"promoted" integer DEFAULT 0 NOT NULL,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "learning_run_detail_check" CHECK (char_length("detail") <= 1000)
);
--> statement-breakpoint
CREATE INDEX "bot_lesson_bot_idx" ON "zetta"."bot_lesson" ("bot_id","status");--> statement-breakpoint
CREATE INDEX "bot_lesson_owner_idx" ON "zetta"."bot_lesson" ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_lesson_item_unique" ON "zetta"."bot_lesson" ("memory_item_id") WHERE "memory_item_id" is not null;--> statement-breakpoint
CREATE INDEX "bot_lesson_event_lesson_idx" ON "zetta"."bot_lesson_event" ("lesson_id","at");--> statement-breakpoint
CREATE INDEX "bot_lesson_evidence_lesson_idx" ON "zetta"."bot_lesson_evidence" ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_lesson_evidence_message_unique" ON "zetta"."bot_lesson_evidence" ("lesson_id","message_id") WHERE "message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_run_daily_unique" ON "zetta"."learning_run" ("bot_id","day","kind") WHERE "trigger" = 'daily';--> statement-breakpoint
CREATE INDEX "learning_run_bot_idx" ON "zetta"."learning_run" ("bot_id","started_at");--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ADD CONSTRAINT "bot_lesson_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ADD CONSTRAINT "bot_lesson_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ADD CONSTRAINT "bot_lesson_memory_item_id_memory_item_id_fkey" FOREIGN KEY ("memory_item_id") REFERENCES "zetta"."memory_item"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson" ADD CONSTRAINT "bot_lesson_skill_id_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "zetta"."skill"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_event" ADD CONSTRAINT "bot_lesson_event_lesson_id_bot_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "zetta"."bot_lesson"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" ADD CONSTRAINT "bot_lesson_evidence_lesson_id_bot_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "zetta"."bot_lesson"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" ADD CONSTRAINT "bot_lesson_evidence_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_lesson_evidence" ADD CONSTRAINT "bot_lesson_evidence_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."learning_policy" ADD CONSTRAINT "learning_policy_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."learning_run" ADD CONSTRAINT "learning_run_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."learning_run" ADD CONSTRAINT "learning_run_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
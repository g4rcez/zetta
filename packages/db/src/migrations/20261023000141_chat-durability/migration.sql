CREATE TABLE "bot_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bot_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"changed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_revision_unique" UNIQUE("bot_id","version")
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "client_request_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "mentions" jsonb;--> statement-breakpoint
ALTER TABLE "attention_item" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "attention_item" ADD COLUMN "occurrences" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "attention_item" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attention_item" ADD COLUMN "completed" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "attention_item" ADD COLUMN "remaining" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "message_client_request_unique" ON "message" ("conversation_id","client_request_id") WHERE "client_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_live_source" ON "attention_item" ("owner_user_id","source_key") WHERE "source_key" is not null and "status" in ('open', 'acknowledged');--> statement-breakpoint
ALTER TABLE "bot_revision" ADD CONSTRAINT "bot_revision_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_revision" ADD CONSTRAINT "bot_revision_changed_by_user_id_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
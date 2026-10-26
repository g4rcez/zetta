CREATE TABLE "agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"kind" text DEFAULT 'event' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"remind_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"source" text DEFAULT 'user' NOT NULL,
	"created_by_bot_id" uuid,
	"conversation_id" uuid,
	"google_event_id" text,
	"google_etag" text,
	"sync_to_google" boolean DEFAULT false NOT NULL,
	"sync_state" text DEFAULT 'local' NOT NULL,
	"sync_error" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agenda_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL UNIQUE,
	"enabled" boolean DEFAULT false NOT NULL,
	"push_by_default" boolean DEFAULT false NOT NULL,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agenda_owner_start_idx" ON "agenda_item" ("owner_user_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_owner_google_event" ON "agenda_item" ("owner_user_id","google_event_id") WHERE "google_event_id" is not null;--> statement-breakpoint
CREATE INDEX "agenda_remind_idx" ON "agenda_item" ("reminded_at","remind_at");--> statement-breakpoint
CREATE INDEX "agenda_sync_state_idx" ON "agenda_item" ("owner_user_id","sync_state");--> statement-breakpoint
CREATE INDEX "agenda_sync_due_idx" ON "agenda_sync" ("enabled","next_sync_at");--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_created_by_bot_id_bot_id_fkey" FOREIGN KEY ("created_by_bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "agenda_sync" ADD CONSTRAINT "agenda_sync_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
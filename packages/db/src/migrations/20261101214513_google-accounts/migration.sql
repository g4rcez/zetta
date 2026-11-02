ALTER TABLE "agenda_item" ADD COLUMN "google_account" text;--> statement-breakpoint
ALTER TABLE "agenda_sync" ADD COLUMN "sync_tokens" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agenda_sync" ADD COLUMN "push_account" text;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "account" text;--> statement-breakpoint
DROP INDEX "agenda_owner_google_event";--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_owner_google_event" ON "agenda_item" ("owner_user_id","google_account","google_event_id") WHERE "google_event_id" is not null;--> statement-breakpoint
ALTER TABLE "knowledge_source" DROP CONSTRAINT "knowledge_source_owner_provider";--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_owner_provider" UNIQUE NULLS NOT DISTINCT("owner_user_id","provider","account");
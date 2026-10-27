ALTER TABLE "conversation" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "archived_at" timestamp with time zone;
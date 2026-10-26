ALTER TABLE "conversation" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;
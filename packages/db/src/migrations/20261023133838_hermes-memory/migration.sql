ALTER TABLE "conversation" ADD COLUMN "memory_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "target" text DEFAULT 'memory' NOT NULL;--> statement-breakpoint
UPDATE "memory" SET "target" = 'user' WHERE "bot_id" IS NULL;

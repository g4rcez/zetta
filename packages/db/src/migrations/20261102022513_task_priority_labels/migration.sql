ALTER TABLE "task" ADD COLUMN "priority" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "labels" text[] DEFAULT '{}'::text[] NOT NULL;
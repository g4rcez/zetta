ALTER TABLE "team" ADD COLUMN "context" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_context_check" CHECK (length("context") <= 8000);
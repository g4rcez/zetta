ALTER TABLE "bot" ADD COLUMN "commit_identity" text DEFAULT 'git-config' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "commit_email" text;
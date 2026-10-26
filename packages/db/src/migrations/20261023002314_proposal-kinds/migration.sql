ALTER TABLE "config_proposal" ADD COLUMN "kind" text DEFAULT 'config' NOT NULL;--> statement-breakpoint
ALTER TABLE "config_proposal" ALTER COLUMN "bot_id" DROP NOT NULL;
ALTER TABLE "zetta"."team" ADD COLUMN "home_discussion_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD COLUMN "nav_mode" text DEFAULT 'full' NOT NULL;
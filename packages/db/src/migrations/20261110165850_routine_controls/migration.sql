ALTER TABLE "zetta"."routine" ADD COLUMN "overlap_policy" text DEFAULT 'skip' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."routine" ADD COLUMN "catch_up" text DEFAULT 'run_once' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."routine" ADD COLUMN "skip_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zetta"."routine" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."routine" ADD COLUMN "max_failures" integer DEFAULT 5 NOT NULL;
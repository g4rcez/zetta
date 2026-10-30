ALTER TABLE "goal_loop" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_loop" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goal_loop" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "goal_loop" ADD COLUMN "lessons" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_run" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_run" ADD COLUMN "retry_at" timestamp with time zone;
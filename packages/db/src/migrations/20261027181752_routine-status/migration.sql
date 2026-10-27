ALTER TABLE "routine" ADD COLUMN "status" text DEFAULT 'paused' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "status_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "routine" SET "status" = 'scheduled' WHERE "paused" = false AND "archived" = false;

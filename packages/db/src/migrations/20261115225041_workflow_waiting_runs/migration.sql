ALTER TABLE "zetta"."workflow_run" ADD COLUMN "input" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ADD COLUMN "cursor" jsonb;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ADD COLUMN "resume_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ADD COLUMN "pending_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ADD COLUMN "routine_run_id" uuid;--> statement-breakpoint
CREATE INDEX "workflow_run_waiting_idx" ON "zetta"."workflow_run" ("status","resume_at") WHERE "status" = 'waiting';
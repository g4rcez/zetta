ALTER TABLE "zetta"."task" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "progress" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "follow_up" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "follow_up_reason" text;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "stalls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
CREATE INDEX "task_parent_idx" ON "zetta"."task" ("parent_task_id");--> statement-breakpoint
CREATE INDEX "task_follow_up_due_idx" ON "zetta"."task" ("next_check_at") WHERE "follow_up" = 'auto' and "parent_task_id" is null and "status" in ('backlog', 'in_progress');--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD CONSTRAINT "task_parent_task_id_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "zetta"."task"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
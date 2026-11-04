ALTER TABLE "zetta"."task" ADD COLUMN "assignee" text DEFAULT 'bot' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "assignee_user_id" text;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "team_id" uuid;--> statement-breakpoint
CREATE INDEX "task_assignee_user_idx" ON "zetta"."task" ("assignee_user_id","status");--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD CONSTRAINT "task_assignee_user_id_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD CONSTRAINT "task_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "zetta"."team"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD CONSTRAINT "task_assignee_check" CHECK ("assignee" = 'bot' or "assignee_user_id" is not null);
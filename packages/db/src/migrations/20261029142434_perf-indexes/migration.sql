CREATE INDEX "goal_loop_running_retry_idx" ON "goal_loop" ("retry_at") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "goal_loop_status_updated_idx" ON "goal_loop" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "routine_run_started_idx" ON "routine_run" ("started_at");--> statement-breakpoint
CREATE INDEX "routine_run_retry_idx" ON "routine_run" ("retry_at") WHERE "status" = 'failed';--> statement-breakpoint
CREATE INDEX "discussion_open_updated_idx" ON "discussion" ("updated_at") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "task_status_updated_idx" ON "task" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "wiki_page_unembedded_idx" ON "wiki_page" ("updated_at") WHERE "embedding" is null;
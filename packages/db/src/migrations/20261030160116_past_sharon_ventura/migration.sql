DROP INDEX "goal_loop_one_active";--> statement-breakpoint
CREATE UNIQUE INDEX "goal_loop_one_active" ON "goal_loop" ("conversation_id","bot_id") WHERE "status" in ('running', 'paused');
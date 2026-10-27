CREATE TABLE "goal_loop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"done_when" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"iterations" integer DEFAULT 0 NOT NULL,
	"progress" text DEFAULT '' NOT NULL,
	"stalls" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot" DROP COLUMN "computer_action_limit";--> statement-breakpoint
CREATE INDEX "goal_loop_conversation_idx" ON "goal_loop" ("conversation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_loop_one_active" ON "goal_loop" ("conversation_id") WHERE "status" in ('running', 'paused');--> statement-breakpoint
ALTER TABLE "goal_loop" ADD CONSTRAINT "goal_loop_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "goal_loop" ADD CONSTRAINT "goal_loop_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "goal_loop" ADD CONSTRAINT "goal_loop_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "config_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"proposed_by_bot_id" uuid,
	"base_version" integer NOT NULL,
	"patch" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
CREATE INDEX "config_proposal_owner_idx" ON "config_proposal" ("owner_user_id","status");--> statement-breakpoint
ALTER TABLE "config_proposal" ADD CONSTRAINT "config_proposal_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "config_proposal" ADD CONSTRAINT "config_proposal_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "config_proposal" ADD CONSTRAINT "config_proposal_proposed_by_bot_id_bot_id_fkey" FOREIGN KEY ("proposed_by_bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "zetta"."approval_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"action_key" text DEFAULT '' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "zetta"."config_proposal" ADD COLUMN "decided_by" text;--> statement-breakpoint
CREATE INDEX "approval_rule_bot_idx" ON "zetta"."approval_rule" ("owner_user_id","bot_id","status");--> statement-breakpoint
CREATE INDEX "approval_rule_bot_id_idx" ON "zetta"."approval_rule" ("bot_id");--> statement-breakpoint
ALTER TABLE "zetta"."approval_rule" ADD CONSTRAINT "approval_rule_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."approval_rule" ADD CONSTRAINT "approval_rule_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
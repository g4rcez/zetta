CREATE TABLE "zetta"."skill_review" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"skill_id" uuid,
	"detail" text DEFAULT '' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "auto_learn" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."skill" ADD COLUMN "learned_by_bot_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" ADD COLUMN "saved_by_bot_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_review_reply_unique" ON "zetta"."skill_review" ("reply_id");--> statement-breakpoint
CREATE INDEX "skill_review_due_idx" ON "zetta"."skill_review" ("status","run_after");--> statement-breakpoint
CREATE INDEX "skill_review_owner_idx" ON "zetta"."skill_review" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "zetta"."skill_review" ADD CONSTRAINT "skill_review_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
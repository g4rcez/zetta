CREATE TABLE "zetta"."learning_finding" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid,
	"kind" text NOT NULL,
	"refs" jsonb NOT NULL,
	"ref_hash" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "learning_finding_summary_check" CHECK (char_length("summary") between 1 and 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "learning_finding_unique" ON "zetta"."learning_finding" ("owner_user_id","kind","ref_hash");--> statement-breakpoint
CREATE INDEX "learning_finding_owner_idx" ON "zetta"."learning_finding" ("owner_user_id","status");--> statement-breakpoint
ALTER TABLE "zetta"."learning_finding" ADD CONSTRAINT "learning_finding_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."learning_finding" ADD CONSTRAINT "learning_finding_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
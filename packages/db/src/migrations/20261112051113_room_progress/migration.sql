ALTER TABLE "zetta"."discussion" ADD COLUMN "progress_percent" integer;--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD COLUMN "progress_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD COLUMN "progress_bot_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD COLUMN "progress_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "discussion_progress_bot_id_idx" ON "zetta"."discussion" ("progress_bot_id");--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD CONSTRAINT "discussion_progress_bot_id_bot_id_fkey" FOREIGN KEY ("progress_bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD CONSTRAINT "discussion_progress_check" CHECK (("progress_percent" is null or "progress_percent" between 0 and 100) and length("progress_note") <= 120);
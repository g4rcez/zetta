ALTER TABLE "zetta"."bot_drive_run" ADD COLUMN "variant" text DEFAULT 'with' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD COLUMN "pair_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD COLUMN "chosen" text;--> statement-breakpoint
CREATE INDEX "bot_drive_run_pair_idx" ON "zetta"."bot_drive_run" ("pair_id");--> statement-breakpoint
ALTER TABLE "zetta"."bot_drive_run" ADD CONSTRAINT "bot_drive_run_pair_check" CHECK (("variant" = 'with' or "pair_id" is not null));--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" DROP CONSTRAINT "reply_outcome_signals_check", ADD CONSTRAINT "reply_outcome_signals_check" CHECK ("signals" <@ ARRAY['thumbs_up','thumbs_down','stopped','steered','corrected','task_done','carried_on','send_now','interrupted','chose_better','chose_worse']::text[]);
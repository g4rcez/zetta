ALTER TABLE "zetta"."voice_call" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD COLUMN "requested_in" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD CONSTRAINT "voice_call_requested_in_conversation_id_fkey" FOREIGN KEY ("requested_in") REFERENCES "zetta"."conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD CONSTRAINT "voice_call_outcome_check" CHECK ("outcome" is null or "outcome" in ('done', 'declined', 'no_answer', 'voicemail', 'failed'));
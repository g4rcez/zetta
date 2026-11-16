ALTER TABLE "zetta"."bot" ADD COLUMN "summary_mode" text DEFAULT 'chief' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "summary_max_chars" integer;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "summary_gap_bytes" integer;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "chat_search_limit" integer;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "transcribe_provider" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "transcribe_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "transcribe_language" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "transcribe_base_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "transcribe_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_summary_max_chars_check" CHECK ("summary_max_chars" is null or "summary_max_chars" between 500 and 6000);--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_summary_gap_bytes_check" CHECK ("summary_gap_bytes" is null or "summary_gap_bytes" between 500 and 20000);--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_chat_search_limit_check" CHECK ("chat_search_limit" is null or "chat_search_limit" between 1 and 10);--> statement-breakpoint
ALTER TABLE "zetta"."conversation_summary" DROP CONSTRAINT "conversation_summary_body_len", ADD CONSTRAINT "conversation_summary_body_len" CHECK (char_length("body") <= 6000);
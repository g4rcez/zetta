CREATE TABLE "zetta"."push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL CONSTRAINT "push_subscription_endpoint_unique" UNIQUE,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_at" timestamp with time zone,
	CONSTRAINT "push_subscription_limits_check" CHECK (length("endpoint") between 1 and 2048 and length("p256dh") between 1 and 128 and length("auth") between 1 and 64 and length("user_agent") <= 200)
);
--> statement-breakpoint
ALTER TABLE "zetta"."connection" ADD COLUMN "config_base_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."connection" ADD COLUMN "config_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "speech_provider" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "speech_base_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "speech_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "speech_voice" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "speech_language" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "speech_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "push_public_key" text;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "push_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD COLUMN "push_mode" text DEFAULT 'mentions_and_approvals' NOT NULL;--> statement-breakpoint
CREATE INDEX "push_subscription_user_id_idx" ON "zetta"."push_subscription" ("user_id");--> statement-breakpoint
ALTER TABLE "zetta"."push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection" ADD CONSTRAINT "connection_config_check" CHECK (length("config_base_url") <= 512 and length("config_model") <= 100);--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD CONSTRAINT "installation_settings_speech_check" CHECK (length("speech_base_url") <= 512 and length("speech_model") <= 100 and length("speech_voice") <= 100 and length("speech_language") <= 35);--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD CONSTRAINT "installation_settings_push_public_key_check" CHECK ("push_public_key" is null or length("push_public_key") between 1 and 200);
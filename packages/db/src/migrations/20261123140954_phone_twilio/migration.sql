ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_twilio" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_twilio_account_sid" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_twilio_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_default_provider" text DEFAULT 'telnyx' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD CONSTRAINT "installation_settings_phone_twilio_check" CHECK ("phone_twilio" in ('off', 'on') and "phone_default_provider" in ('telnyx', 'twilio') and length("phone_twilio_account_sid") <= 34);--> statement-breakpoint
ALTER TABLE "zetta"."phone_number" DROP CONSTRAINT "phone_number_provider_check", ADD CONSTRAINT "phone_number_provider_check" CHECK ("provider" in ('off', 'telnyx', 'twilio'));
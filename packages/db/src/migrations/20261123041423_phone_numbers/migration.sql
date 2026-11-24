CREATE TABLE "zetta"."phone_number" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"e164" text,
	"provider" text DEFAULT 'telnyx' NOT NULL,
	"provider_ref" text,
	"country" text NOT NULL,
	"area_code" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"inbound" text DEFAULT 'owner_only' NOT NULL,
	"outbound" text DEFAULT 'on' NOT NULL,
	"owner_number" text,
	"pin_hash" text,
	"pin_failures" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"held_until" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_number_provider_check" CHECK ("provider" in ('off', 'telnyx')),
	CONSTRAINT "phone_number_status_check" CHECK ("status" in ('requested', 'pending_review', 'active', 'held', 'released', 'failed')),
	CONSTRAINT "phone_number_inbound_check" CHECK ("inbound" in ('anyone', 'owner_only', 'off')),
	CONSTRAINT "phone_number_outbound_check" CHECK ("outbound" in ('on', 'off')),
	CONSTRAINT "phone_number_e164_check" CHECK ("e164" is null or "e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "phone_number_owner_number_check" CHECK ("owner_number" is null or "owner_number" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "phone_number_country_check" CHECK ("country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "phone_number_area_check" CHECK ("area_code" is null or "area_code" ~ '^[0-9]{1,6}$'),
	CONSTRAINT "phone_number_provider_ref_check" CHECK ("provider_ref" is null or length("provider_ref") <= 200),
	CONSTRAINT "phone_number_pin_failures_check" CHECK ("pin_failures" between 0 and 100),
	CONSTRAINT "phone_number_pin_hash_check" CHECK ("pin_hash" is null or length("pin_hash") <= 300),
	CONSTRAINT "phone_number_has_number_check" CHECK ("e164" is not null or "status" in ('requested', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "zetta"."phone_optout" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"e164" text NOT NULL,
	"reason" text DEFAULT 'operator' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_optout_e164_check" CHECK ("e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "phone_optout_reason_check" CHECK ("reason" in ('caller_request', 'operator', 'complaint'))
);
--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_provider" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_public_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_public_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_application_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_request_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_countries" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_max_numbers" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_max_call_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_daily_minutes_per_bot" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "phone_daily_calls_per_bot" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_number_e164_key" ON "zetta"."phone_number" ("e164") WHERE "status" <> 'released' and "e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_number_bot_open_key" ON "zetta"."phone_number" ("bot_id") WHERE "status" in ('requested', 'pending_review', 'active');--> statement-breakpoint
CREATE INDEX "phone_number_owner_idx" ON "zetta"."phone_number" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "phone_number_held_idx" ON "zetta"."phone_number" ("held_until") WHERE "status" = 'held';--> statement-breakpoint
CREATE UNIQUE INDEX "phone_optout_e164_key" ON "zetta"."phone_optout" ("e164");--> statement-breakpoint
ALTER TABLE "zetta"."phone_number" ADD CONSTRAINT "phone_number_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."phone_number" ADD CONSTRAINT "phone_number_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."phone_optout" ADD CONSTRAINT "phone_optout_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "zetta"."user"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD CONSTRAINT "voice_call_number_id_phone_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "zetta"."phone_number"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD CONSTRAINT "installation_settings_phone_check" CHECK ("phone_provider" in ('off', 'telnyx') and "phone_request_mode" in ('off', 'owner_request', 'operator_approval') and length("phone_public_key") <= 200 and length("phone_public_url") <= 512 and length("phone_application_id") <= 100 and length("phone_countries") <= 200);--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD CONSTRAINT "installation_settings_phone_limits_check" CHECK ("phone_max_numbers" between 0 and 1000 and "phone_max_call_minutes" between 1 and 240 and "phone_daily_minutes_per_bot" between 0 and 1440 and "phone_daily_calls_per_bot" between 0 and 1000);
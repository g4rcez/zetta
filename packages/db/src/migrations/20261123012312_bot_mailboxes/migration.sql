CREATE TABLE "zetta"."mailbox_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"mailbox_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"direction" text NOT NULL,
	"message_id" text DEFAULT '' NOT NULL,
	"in_reply_to" text DEFAULT '' NOT NULL,
	"references" jsonb DEFAULT '[]' NOT NULL,
	"thread_key" text NOT NULL,
	"from_address" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"to_addresses" jsonb DEFAULT '[]' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"text_body" text DEFAULT '' NOT NULL,
	"authentication" jsonb DEFAULT '{}' NOT NULL,
	"attachments" text DEFAULT 'none' NOT NULL,
	"raw_mime" bytea,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_message_direction_check" CHECK ("direction" in ('in', 'out')),
	CONSTRAINT "mailbox_message_attachments_check" CHECK ("attachments" in ('none', 'some')),
	CONSTRAINT "mailbox_message_raw_check" CHECK ("raw_mime" is null or length("raw_mime") <= 15728640),
	CONSTRAINT "mailbox_message_refs_check" CHECK (jsonb_typeof("references") = 'array'),
	CONSTRAINT "mailbox_message_to_check" CHECK (jsonb_typeof("to_addresses") = 'array')
);
--> statement-breakpoint
ALTER TABLE "zetta"."inbound_route" ADD COLUMN "mailbox_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "mail_provider" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "mail_domain" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "mail_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "mail_cursor" text;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_route_owner_plugin_unique" ON "zetta"."inbound_route" ("owner_user_id","plugin_id") WHERE "mailbox_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_route_mailbox_unique" ON "zetta"."inbound_route" ("mailbox_id") WHERE "mailbox_id" is not null;--> statement-breakpoint
-- The old one-route-per-person-and-plugin rule goes only now that the partial index above enforces it for every existing row (all have a null mailbox_id).
ALTER TABLE "zetta"."inbound_route" DROP CONSTRAINT "inbound_route_owner_plugin";--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_message_provider_ref_unique" ON "zetta"."mailbox_message" ("mailbox_id","provider_ref");--> statement-breakpoint
CREATE INDEX "mailbox_message_thread_idx" ON "zetta"."mailbox_message" ("mailbox_id","thread_key","date");--> statement-breakpoint
CREATE INDEX "mailbox_message_id_idx" ON "zetta"."mailbox_message" ("mailbox_id","message_id");--> statement-breakpoint
ALTER TABLE "zetta"."inbound_route" ADD CONSTRAINT "inbound_route_mailbox_id_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "zetta"."mailbox"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox_message" ADD CONSTRAINT "mailbox_message_mailbox_id_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "zetta"."mailbox"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD CONSTRAINT "installation_settings_mail_check" CHECK ("mail_provider" in ('off', 'resend') and length("mail_domain") <= 253 and ("mail_cursor" is null or length("mail_cursor") <= 200));
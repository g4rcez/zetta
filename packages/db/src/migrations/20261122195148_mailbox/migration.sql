CREATE TABLE "zetta"."mailbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"sending" text DEFAULT 'on' NOT NULL,
	"connection_id" uuid,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"allowed_senders" jsonb DEFAULT '[]' NOT NULL,
	"chat_conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_kind_check" CHECK ("kind" in ('imap', 'google', 'provisioned')),
	CONSTRAINT "mailbox_state_check" CHECK ("state" in ('active', 'needs_auth', 'error', 'retired')),
	CONSTRAINT "mailbox_sending_check" CHECK ("sending" in ('on', 'off')),
	CONSTRAINT "mailbox_address_check" CHECK (length(btrim("address")) between 3 and 320),
	CONSTRAINT "mailbox_label_check" CHECK (length("label") <= 120),
	CONSTRAINT "mailbox_last_error_check" CHECK ("last_error" is null or length("last_error") <= 500),
	CONSTRAINT "mailbox_allowed_senders_check" CHECK (jsonb_typeof("allowed_senders") = 'array'),
	CONSTRAINT "mailbox_config_check" CHECK (jsonb_typeof("config") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_owner_kind_address_unique" ON "zetta"."mailbox" ("owner_user_id","kind",lower("address"));--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_provisioned_address_unique" ON "zetta"."mailbox" (lower("address")) WHERE "kind" = 'provisioned';--> statement-breakpoint
CREATE INDEX "mailbox_bot_id_idx" ON "zetta"."mailbox" ("bot_id");--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD CONSTRAINT "mailbox_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD CONSTRAINT "mailbox_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD CONSTRAINT "mailbox_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "zetta"."connection"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."mailbox" ADD CONSTRAINT "mailbox_chat_conversation_id_conversation_id_fkey" FOREIGN KEY ("chat_conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
CREATE TABLE "zetta"."bot_engine" (
	"bot_id" uuid,
	"user_id" text,
	"harness" text,
	"model" text,
	"account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_engine_pkey" PRIMARY KEY("bot_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "zetta"."engine_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"engine" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text,
	"label" text NOT NULL,
	"use" text DEFAULT 'default' NOT NULL,
	"state" text NOT NULL,
	"connection_id" uuid,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_account_kind_check" CHECK ("kind" in ('login', 'token', 'api_key')),
	CONSTRAINT "engine_account_state_check" CHECK ("state" in ('pending', 'active', 'signed_out')),
	CONSTRAINT "engine_account_use_check" CHECK ("use" in ('default', 'extra')),
	CONSTRAINT "engine_account_label_check" CHECK (length("label") between 1 and 80),
	CONSTRAINT "engine_account_secret_check" CHECK (("kind" = 'login' and "connection_id" is null) or ("kind" <> 'login' and ("state" <> 'active' or "connection_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "shared_account" text DEFAULT 'asker' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD COLUMN "payer_user_id" text;--> statement-breakpoint
CREATE INDEX "bot_engine_user_id_idx" ON "zetta"."bot_engine" ("user_id");--> statement-breakpoint
CREATE INDEX "bot_engine_account_id_idx" ON "zetta"."bot_engine" ("account_id");--> statement-breakpoint
CREATE INDEX "engine_account_owner_idx" ON "zetta"."engine_account" ("owner_user_id","engine");--> statement-breakpoint
CREATE INDEX "engine_account_connection_id_idx" ON "zetta"."engine_account" ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_account_one_default" ON "zetta"."engine_account" ("owner_user_id","engine") WHERE "use" = 'default' and "state" = 'active';--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" ADD CONSTRAINT "bot_engine_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" ADD CONSTRAINT "bot_engine_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_engine" ADD CONSTRAINT "bot_engine_account_id_engine_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "zetta"."engine_account"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."engine_account" ADD CONSTRAINT "engine_account_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."engine_account" ADD CONSTRAINT "engine_account_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "zetta"."connection"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
CREATE TABLE "bot_claude_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bot_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"tools" jsonb DEFAULT '[]' NOT NULL,
	"model" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_claude_asset_unique" UNIQUE("bot_id","kind","name"),
	CONSTRAINT "bot_claude_asset_name_check" CHECK ("name" ~ '^[a-z][a-z0-9-]*$' and length("name") <= 63)
);
--> statement-breakpoint
CREATE TABLE "bot_claude_config" (
	"bot_id" uuid PRIMARY KEY,
	"preset" text DEFAULT 'auto' NOT NULL,
	"allow" jsonb DEFAULT '[]' NOT NULL,
	"deny" jsonb DEFAULT '[]' NOT NULL,
	"append_prompt" text DEFAULT '' NOT NULL,
	"effort" text,
	"max_budget_cents" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_claude_asset" ADD CONSTRAINT "bot_claude_asset_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_claude_config" ADD CONSTRAINT "bot_claude_config_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
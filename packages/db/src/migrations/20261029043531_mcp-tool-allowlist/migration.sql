ALTER TABLE "bot_integration" ADD COLUMN "tools_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_integration" ADD COLUMN "allowed_tools" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "tools" jsonb DEFAULT '[]' NOT NULL;
ALTER TABLE "discussion" ADD COLUMN "kind" text DEFAULT 'room' NOT NULL;--> statement-breakpoint
UPDATE "discussion" SET "kind" = 'help' WHERE "team_id" IS NULL AND "created_by_bot_id" IS NOT NULL AND "title" LIKE 'Help: %';--> statement-breakpoint
UPDATE "discussion" SET "kind" = 'permissions' WHERE "team_id" IS NULL AND "created_by_bot_id" IS NOT NULL AND "title" = 'Permissions';--> statement-breakpoint
UPDATE "attention_item" SET "result_link" = '/rooms?id=' || substr("result_link", length('/discussions?id=') + 1) WHERE "result_link" LIKE '/discussions?id=%';

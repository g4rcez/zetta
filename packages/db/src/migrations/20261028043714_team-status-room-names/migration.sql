ALTER TABLE "team" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE "team" SET "status" = 'archived' WHERE "archived" = true;--> statement-breakpoint
DROP INDEX "team_owner_name_unique";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "archived";--> statement-breakpoint
CREATE UNIQUE INDEX "team_owner_name_unique" ON "team" ("owner_user_id",lower("name")) WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_room_name_unique" ON "discussion" ("owner_user_id",lower("title")) WHERE "team_id" is not null;

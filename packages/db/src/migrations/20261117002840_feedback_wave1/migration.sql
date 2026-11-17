CREATE TABLE "zetta"."message_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"message_id" uuid NOT NULL,
	"content" text NOT NULL,
	"edited_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_revision_content_check" CHECK (length("content") <= 65536)
);
--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "role" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."message" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zetta"."installation_settings" ADD COLUMN "update_check" text DEFAULT 'on' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD COLUMN "job_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD COLUMN "department" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD COLUMN "about" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD COLUMN "timezone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD COLUMN "contact" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Bot role: a bot that holds exactly one seat in the organization chart starts with that seat's title (cut to the 60 characters a role may have).
UPDATE "zetta"."bot" AS b SET "role" = left(btrim(p."title"), 60)
FROM (SELECT "bot_id", min("title") AS "title" FROM "zetta"."org_position" WHERE "bot_id" IS NOT NULL GROUP BY "bot_id" HAVING count(*) = 1) AS p
WHERE p."bot_id" = b."id" AND b."role" = '';--> statement-breakpoint
-- New people start in the simple view. Everyone who exists now keeps the full view: a person with no preference row was reading the old
-- default ('full') from code, so an explicit row is written for them BEFORE the column default changes. No existing row is touched.
INSERT INTO "zetta"."user_preference" ("owner_user_id", "nav_mode")
SELECT u."id", 'full' FROM "zetta"."user" AS u
WHERE NOT EXISTS (SELECT 1 FROM "zetta"."user_preference" AS up WHERE up."owner_user_id" = u."id");--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ALTER COLUMN "nav_mode" SET DEFAULT 'simple';--> statement-breakpoint
CREATE INDEX "message_revision_message_id_idx" ON "zetta"."message_revision" ("message_id","created_at");--> statement-breakpoint
ALTER TABLE "zetta"."message_revision" ADD CONSTRAINT "message_revision_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_revision" ADD CONSTRAINT "message_revision_edited_by_user_id_user_id_fkey" FOREIGN KEY ("edited_by_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_role_check" CHECK (length("role") <= 60);--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD CONSTRAINT "user_preference_job_title_check" CHECK (length("job_title") <= 80);--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD CONSTRAINT "user_preference_department_check" CHECK (length("department") <= 80);--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD CONSTRAINT "user_preference_about_check" CHECK (length("about") <= 1000);--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD CONSTRAINT "user_preference_timezone_check" CHECK (length("timezone") <= 64);--> statement-breakpoint
ALTER TABLE "zetta"."user_preference" ADD CONSTRAINT "user_preference_contact_check" CHECK (length("contact") <= 200);
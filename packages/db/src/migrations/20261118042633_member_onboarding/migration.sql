ALTER TABLE "zetta"."user_preference" ADD COLUMN "member_onboarding" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
-- Everyone who exists now already uses the app: only accounts created after this migration go through the onboarding.
UPDATE "zetta"."user_preference" SET "member_onboarding" = 'done';
--> statement-breakpoint
INSERT INTO "zetta"."user_preference" ("owner_user_id", "member_onboarding")
SELECT "id", 'done' FROM "zetta"."user" ON CONFLICT ("owner_user_id") DO NOTHING;

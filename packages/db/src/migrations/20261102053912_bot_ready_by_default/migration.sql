ALTER TABLE "bot" ALTER COLUMN "onboarded" SET DEFAULT true;
--> statement-breakpoint
UPDATE "bot" SET "onboarded" = true WHERE "onboarded" = false;

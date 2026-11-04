-- Better Auth already stores the email in lower case; this fixes any row written another way. A collision between two rows fails here on UNIQUE(email) and nothing is lost.
UPDATE "zetta"."user" SET "email" = lower("email") WHERE "email" <> lower("email");--> statement-breakpoint
ALTER TABLE "zetta"."user" ADD CONSTRAINT "user_email_canonical_check" CHECK ("email" = lower("email"));

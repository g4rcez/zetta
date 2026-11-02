-- Both knowledge_doc statements settle drift left by 20261102024434_drive_into_wiki (its SQL creates the index but never drops the old unique one); IF [NOT] EXISTS keeps this safe whichever way that is fixed.
DROP INDEX IF EXISTS "knowledge_doc_page_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_doc_page_idx" ON "knowledge_doc" ("page_id");--> statement-breakpoint
ALTER TABLE "routine_run" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
-- Every run that exists now counts as seen, so the Routines badge starts at zero instead of showing the whole history.
UPDATE "routine_run" SET "read_at" = coalesce("finished_at", "started_at");--> statement-breakpoint
CREATE INDEX "routine_run_unread_idx" ON "routine_run" ("owner_user_id") WHERE "read_at" is null;

ALTER TABLE "routine" ADD COLUMN "origin_discussion_id" uuid;--> statement-breakpoint
CREATE INDEX "routine_origin_discussion_id_idx" ON "routine" ("origin_discussion_id");--> statement-breakpoint
ALTER TABLE "routine" ADD CONSTRAINT "routine_origin_discussion_id_discussion_id_fkey" FOREIGN KEY ("origin_discussion_id") REFERENCES "discussion"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
-- Backfill: a routine whose approved proposal was announced in a room's message gets that room.
UPDATE "routine" r SET "origin_discussion_id" = d."id"
FROM "config_proposal" p
JOIN "message" m ON m."meta"->'receipts' @> jsonb_build_array(jsonb_build_object('id', p."id"::text, 'kind', 'proposal'))
JOIN "discussion" d ON d."conversation_id" = m."conversation_id"
WHERE p."kind" = 'create_routine' AND p."status" = 'approved'
  AND p."owner_user_id" = r."owner_user_id" AND p."patch"->>'title' = r."title"
  AND r."created_at" BETWEEN p."decided_at" - interval '5 seconds' AND p."decided_at" + interval '1 minute'
  AND r."origin_discussion_id" IS NULL;

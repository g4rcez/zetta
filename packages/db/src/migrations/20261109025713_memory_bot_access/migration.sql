ALTER TABLE "zetta"."memory_item" ADD COLUMN "bot_access" text DEFAULT 'suggest' NOT NULL;
--> statement-breakpoint
-- Bots write what bots created, their own notes and the lists they keep up; the rest of a person's items take suggestions. The earliest
-- revision says who created an item (every save writes one); an item with none (a Drive document) falls back to updated_by.
UPDATE "zetta"."memory_item" p SET "bot_access" = 'edit'
WHERE p."type" = 'solo'
   OR 'list' = ANY(p."tags")
   OR coalesce(
        (SELECT r."author" FROM "zetta"."memory_revision" r WHERE r."page_id" = p."id" ORDER BY r."version" LIMIT 1),
        p."updated_by"
      ) <> 'user';
--> statement-breakpoint
-- The text of a Drive document belongs to the sync alone.
UPDATE "zetta"."memory_item" SET "bot_access" = 'read'
WHERE "id" IN (SELECT "page_id" FROM "zetta"."knowledge_doc" WHERE "page_id" IS NOT NULL);

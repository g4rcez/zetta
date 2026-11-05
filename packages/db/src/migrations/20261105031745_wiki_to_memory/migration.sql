ALTER TABLE "zetta"."wiki_chunk" RENAME TO "memory_chunk";--> statement-breakpoint
ALTER TABLE "zetta"."wiki_page" RENAME TO "memory_item";--> statement-breakpoint
ALTER TABLE "zetta"."wiki_page_team" RENAME TO "memory_item_team";--> statement-breakpoint
ALTER TABLE "zetta"."wiki_job" RENAME TO "memory_job";--> statement-breakpoint
ALTER TABLE "zetta"."wiki_link" RENAME TO "memory_link";--> statement-breakpoint
ALTER TABLE "zetta"."wiki_revision" RENAME TO "memory_revision";--> statement-breakpoint
ALTER TABLE "zetta"."wiki_source" RENAME TO "memory_source";--> statement-breakpoint
ALTER TABLE "zetta"."wiki_suggestion" RENAME TO "memory_suggestion";--> statement-breakpoint
ALTER TABLE "zetta"."conversation" RENAME COLUMN "memory_snapshot" TO "notes_snapshot";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" RENAME CONSTRAINT "wiki_page_score" TO "memory_item_score";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_chunk_owner_idx" RENAME TO "memory_chunk_owner_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_chunk_unembedded_idx" RENAME TO "memory_chunk_unembedded_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_chunk_embedding_idx" RENAME TO "memory_chunk_embedding_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_page_shared_slug" RENAME TO "memory_item_shared_slug";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_page_owner_idx" RENAME TO "memory_item_owner_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_page_author_bot_idx" RENAME TO "memory_item_author_bot_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_page_tags_idx" RENAME TO "memory_item_tags_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_page_search_idx" RENAME TO "memory_item_search_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_page_team_team_idx" RENAME TO "memory_item_team_team_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_job_source_once" RENAME TO "memory_job_source_once";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_job_due_idx" RENAME TO "memory_job_due_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_job_owner_idx" RENAME TO "memory_job_owner_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_link_to_idx" RENAME TO "memory_link_to_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_revision_owner_idx" RENAME TO "memory_revision_owner_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_source_check_idx" RENAME TO "memory_source_check_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_source_owner_idx" RENAME TO "memory_source_owner_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_suggestion_open_once" RENAME TO "memory_suggestion_open_once";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_suggestion_owner_idx" RENAME TO "memory_suggestion_owner_idx";--> statement-breakpoint
ALTER INDEX "zetta"."wiki_suggestion_author_idx" RENAME TO "memory_suggestion_author_idx";--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" RENAME CONSTRAINT "wiki_chunk_page_ord" TO "memory_chunk_page_ord";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" RENAME CONSTRAINT "wiki_page_owner_slug" TO "memory_item_owner_slug";--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" RENAME CONSTRAINT "wiki_revision_page_version" TO "memory_revision_page_version";--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" RENAME CONSTRAINT "wiki_source_page_ref" TO "memory_source_page_ref";--> statement-breakpoint
ALTER TABLE "zetta"."knowledge_doc" RENAME CONSTRAINT "knowledge_doc_page_id_wiki_page_id_fkey" TO "knowledge_doc_page_id_memory_item_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" RENAME CONSTRAINT "wiki_chunk_page_id_wiki_page_id_fkey" TO "memory_chunk_page_id_memory_item_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" RENAME CONSTRAINT "wiki_chunk_owner_user_id_user_id_fkey" TO "memory_chunk_owner_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" RENAME CONSTRAINT "wiki_page_owner_user_id_user_id_fkey" TO "memory_item_owner_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" RENAME CONSTRAINT "wiki_page_updated_by_bot_id_bot_id_fkey" TO "memory_item_updated_by_bot_id_bot_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" RENAME CONSTRAINT "wiki_page_author_bot_id_bot_id_fkey" TO "memory_item_author_bot_id_bot_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" RENAME CONSTRAINT "wiki_page_team_page_id_wiki_page_id_fkey" TO "memory_item_team_page_id_memory_item_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" RENAME CONSTRAINT "wiki_page_team_team_id_team_id_fkey" TO "memory_item_team_team_id_team_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" RENAME CONSTRAINT "wiki_job_owner_user_id_user_id_fkey" TO "memory_job_owner_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" RENAME CONSTRAINT "wiki_job_bot_id_bot_id_fkey" TO "memory_job_bot_id_bot_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" RENAME CONSTRAINT "wiki_job_conversation_id_conversation_id_fkey" TO "memory_job_conversation_id_conversation_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_link" RENAME CONSTRAINT "wiki_link_from_page_id_wiki_page_id_fkey" TO "memory_link_from_page_id_memory_item_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" RENAME CONSTRAINT "wiki_revision_page_id_wiki_page_id_fkey" TO "memory_revision_page_id_memory_item_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" RENAME CONSTRAINT "wiki_revision_owner_user_id_user_id_fkey" TO "memory_revision_owner_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" RENAME CONSTRAINT "wiki_revision_bot_id_bot_id_fkey" TO "memory_revision_bot_id_bot_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" RENAME CONSTRAINT "wiki_revision_conversation_id_conversation_id_fkey" TO "memory_revision_conversation_id_conversation_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" RENAME CONSTRAINT "wiki_source_page_id_wiki_page_id_fkey" TO "memory_source_page_id_memory_item_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" RENAME CONSTRAINT "wiki_source_owner_user_id_user_id_fkey" TO "memory_source_owner_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" RENAME CONSTRAINT "wiki_suggestion_page_id_wiki_page_id_fkey" TO "memory_suggestion_page_id_memory_item_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" RENAME CONSTRAINT "wiki_suggestion_page_owner_user_id_user_id_fkey" TO "memory_suggestion_page_owner_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" RENAME CONSTRAINT "wiki_suggestion_author_user_id_user_id_fkey" TO "memory_suggestion_author_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" RENAME CONSTRAINT "wiki_suggestion_bot_id_bot_id_fkey" TO "memory_suggestion_bot_id_bot_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_team" RENAME CONSTRAINT "wiki_page_team_pkey" TO "memory_item_team_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_link" RENAME CONSTRAINT "wiki_link_pkey" TO "memory_link_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_chunk" RENAME CONSTRAINT "wiki_chunk_pkey" TO "memory_chunk_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_item" RENAME CONSTRAINT "wiki_page_pkey" TO "memory_item_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" RENAME CONSTRAINT "wiki_job_pkey" TO "memory_job_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_revision" RENAME CONSTRAINT "wiki_revision_pkey" TO "memory_revision_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_source" RENAME CONSTRAINT "wiki_source_pkey" TO "memory_source_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."memory_suggestion" RENAME CONSTRAINT "wiki_suggestion_pkey" TO "memory_suggestion_pkey";--> statement-breakpoint

-- Postgres 18 names every NOT NULL constraint after its table and does not rename it with the table. This block exists only while the migration runs.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint WHERE contype = 'n' AND conname LIKE 'wiki\_%' AND connamespace = 'zetta'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.t, r.conname, regexp_replace(replace(r.conname, 'wiki_page', 'memory_item'), '^wiki_', 'memory_'));
  END LOOP;
END $$;--> statement-breakpoint

-- Stored values that carry the old name. Rows are rewritten, none are removed.
UPDATE "zetta"."config_proposal" SET "kind" = 'create_memory_item' WHERE "kind" = 'create_wiki_page';--> statement-breakpoint
UPDATE "zetta"."config_proposal" SET "diff" = (SELECT jsonb_agg(CASE WHEN e->>'field' = 'wiki' THEN jsonb_set(e, '{field}', '"memory"') ELSE e END ORDER BY ord) FROM jsonb_array_elements("diff") WITH ORDINALITY AS t(e, ord)) WHERE jsonb_typeof("diff") = 'array' AND "diff" @> '[{"field": "wiki"}]'::jsonb;--> statement-breakpoint
UPDATE "zetta"."config_proposal" SET "patch" = jsonb_set("patch", '{tool}', '"memory_admin"') WHERE "patch"->>'tool' = 'wiki_admin';--> statement-breakpoint
UPDATE "zetta"."attention_item" SET "source_key" = regexp_replace("source_key", '^wiki-(suggestion|stale):', 'memory-\1:') WHERE "source_key" ~ '^wiki-(suggestion|stale):';--> statement-breakpoint
UPDATE "zetta"."attention_item" SET "result_link" = regexp_replace("result_link", '^/wiki', '/memory') WHERE "result_link" ~ '^/wiki(/|$)';--> statement-breakpoint
UPDATE "zetta"."message" SET "meta" = jsonb_set("meta" #- '{used,wiki}', '{used,items}', "meta" #> '{used,wiki}') WHERE "meta" #> '{used,wiki}' IS NOT NULL;--> statement-breakpoint
UPDATE "zetta"."message" SET "meta" = jsonb_set("meta" #- '{used,memories}', '{used,notes}', "meta" #> '{used,memories}') WHERE "meta" #> '{used,memories}' IS NOT NULL;--> statement-breakpoint
UPDATE "zetta"."message" SET "meta" = jsonb_set("meta", '{receipts}', (SELECT jsonb_agg(CASE e->>'kind' WHEN 'wiki' THEN jsonb_set(e, '{kind}', '"memory"') WHEN 'memory' THEN jsonb_set(e, '{kind}', '"note"') WHEN 'instruction' THEN jsonb_set(e, '{kind}', '"note"') ELSE e END ORDER BY ord) FROM jsonb_array_elements("meta"->'receipts') WITH ORDINALITY AS t(e, ord))) WHERE jsonb_typeof("meta"->'receipts') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements("meta"->'receipts') AS r(e) WHERE r.e->>'kind' IN ('wiki', 'memory', 'instruction'));--> statement-breakpoint
UPDATE "zetta"."message" SET "meta" = jsonb_set("meta" #- '{wikiIds}', '{memoryIds}', "meta"->'wikiIds') WHERE "meta" ? 'wikiIds';--> statement-breakpoint
UPDATE "zetta"."chat_queue" SET "input" = jsonb_set("input" #- '{wikiIds}', '{memoryIds}', "input"->'wikiIds') WHERE "input" ? 'wikiIds';--> statement-breakpoint
UPDATE "zetta"."memory_item" SET "tags" = array_replace("tags", 'memory', 'note') WHERE 'memory' = ANY("tags");--> statement-breakpoint
-- The frozen notes of a conversation had the old shape ({user, memory}); they are frozen again at the next turn.
UPDATE "zetta"."conversation" SET "notes_snapshot" = NULL WHERE "notes_snapshot" IS NOT NULL;

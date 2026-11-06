-- Search ranks every matching item by its words. The words were lexed from the text again on each search (a few milliseconds per match,
-- on every chat turn); the database now keeps them in a generated column that the GIN index covers. Added before the old index is
-- dropped, so search always has an index. Adding the column rewrites the table once.
ALTER TABLE "zetta"."memory_item" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', f_unaccent(title || ' ' || howto || ' ' || content))) STORED;--> statement-breakpoint
CREATE INDEX "memory_item_search_tsv_idx" ON "zetta"."memory_item" USING gin ("search_tsv");--> statement-breakpoint
DROP INDEX "zetta"."memory_item_search_idx";

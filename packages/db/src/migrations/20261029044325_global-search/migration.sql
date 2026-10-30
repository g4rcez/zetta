CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- unaccent() is only STABLE; this wrapper pins the dictionary so it can be used in index expressions.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT public.unaccent('public.unaccent', $1) $$;--> statement-breakpoint
CREATE INDEX "conversation_search_idx" ON "conversation" USING gin (to_tsvector('simple', f_unaccent("title")));--> statement-breakpoint
CREATE INDEX "message_search_idx" ON "message" USING gin (to_tsvector('simple', f_unaccent("content")));--> statement-breakpoint
CREATE INDEX "instruction_search_idx" ON "instruction" USING gin (to_tsvector('simple', f_unaccent("title" || ' ' || "body")));--> statement-breakpoint
CREATE INDEX "memory_search_idx" ON "memory" USING gin (to_tsvector('simple', f_unaccent("content")));--> statement-breakpoint
CREATE INDEX "task_search_idx" ON "task" USING gin (to_tsvector('simple', f_unaccent("title" || ' ' || "description")));--> statement-breakpoint
CREATE INDEX "artifact_search_idx" ON "artifact" USING gin (to_tsvector('simple', f_unaccent("title" || ' ' || "description" || ' ' || "file_name")));
CREATE TABLE "wiki_chunk" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"ord" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_chunk_page_ord" UNIQUE("page_id","ord")
);
--> statement-breakpoint
CREATE TABLE "wiki_link" (
	"from_page_id" uuid,
	"relation" text DEFAULT 'related',
	"to_slug" text,
	CONSTRAINT "wiki_link_pkey" PRIMARY KEY("from_page_id","relation","to_slug")
);
--> statement-breakpoint
CREATE TABLE "wiki_page_team" (
	"page_id" uuid,
	"team_id" uuid,
	CONSTRAINT "wiki_page_team_pkey" PRIMARY KEY("page_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_page" RENAME COLUMN "summary" TO "howto";--> statement-breakpoint
ALTER TABLE "wiki_page" RENAME COLUMN "body" TO "content";--> statement-breakpoint
ALTER TABLE "wiki_revision" RENAME COLUMN "summary" TO "howto";--> statement-breakpoint
ALTER TABLE "wiki_revision" RENAME COLUMN "body" TO "content";--> statement-breakpoint
ALTER TABLE "wiki_suggestion" RENAME COLUMN "summary" TO "howto";--> statement-breakpoint
ALTER TABLE "wiki_suggestion" RENAME COLUMN "body" TO "content";--> statement-breakpoint
DROP INDEX "wiki_page_unembedded_idx";--> statement-breakpoint
DROP INDEX "wiki_page_embedding_idx";--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "score" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "author_bot_id" uuid;--> statement-breakpoint
ALTER TABLE "wiki_revision" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_suggestion" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Old shared-slug index is on `scope`; drop it before the data move and recreate it on `type = 'all'` below.
DROP INDEX "wiki_page_shared_slug";--> statement-breakpoint
-- Data move: the old kind of a page becomes a tag (plain `note` carried no information), scope becomes the new type.
UPDATE "wiki_page" SET "tags" = CASE WHEN "type" = 'note' THEN '{}'::text[] ELSE ARRAY["type"] END;--> statement-breakpoint
UPDATE "wiki_revision" SET "tags" = CASE WHEN "type" = 'note' THEN '{}'::text[] ELSE ARRAY["type"] END;--> statement-breakpoint
UPDATE "wiki_suggestion" SET "tags" = CASE WHEN "type" = 'note' THEN '{}'::text[] ELSE ARRAY["type"] END;--> statement-breakpoint
UPDATE "wiki_page" SET "type" = CASE WHEN "scope" = 'installation' THEN 'all' ELSE 'owner' END;--> statement-breakpoint
-- The bot that wrote the first version is the author.
UPDATE "wiki_page" p SET "author_bot_id" = r."bot_id" FROM "wiki_revision" r WHERE r."page_id" = p."id" AND r."version" = 1 AND r."bot_id" IS NOT NULL;--> statement-breakpoint
-- Edges of the graph from the plain [[slug]] links already written. Chunks and embeddings are rebuilt by the server ticker.
INSERT INTO "wiki_link" ("from_page_id", "relation", "to_slug") SELECT DISTINCT p."id", 'related', m[1] FROM "wiki_page" p, regexp_matches(p."content", '\[\[([a-z0-9-]+)\]\]', 'g') m WHERE m[1] <> p."slug" ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "wiki_page" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "wiki_page" DROP COLUMN "embedding";--> statement-breakpoint
ALTER TABLE "wiki_revision" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "wiki_suggestion" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "wiki_page" ALTER COLUMN "type" SET DEFAULT 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_page_shared_slug" ON "wiki_page" ("slug") WHERE "type" = 'all';--> statement-breakpoint
DROP INDEX "wiki_page_search_idx";--> statement-breakpoint
CREATE INDEX "wiki_page_search_idx" ON "wiki_page" USING gin (to_tsvector('simple', f_unaccent("title" || ' ' || "howto" || ' ' || "content")));--> statement-breakpoint
CREATE INDEX "wiki_chunk_owner_idx" ON "wiki_chunk" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "wiki_chunk_unembedded_idx" ON "wiki_chunk" ("created_at") WHERE "embedding" is null;--> statement-breakpoint
CREATE INDEX "wiki_chunk_embedding_idx" ON "wiki_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "wiki_link_to_idx" ON "wiki_link" ("to_slug");--> statement-breakpoint
CREATE INDEX "wiki_page_author_bot_idx" ON "wiki_page" ("author_bot_id");--> statement-breakpoint
CREATE INDEX "wiki_page_tags_idx" ON "wiki_page" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "wiki_page_team_team_idx" ON "wiki_page_team" ("team_id");--> statement-breakpoint
ALTER TABLE "wiki_chunk" ADD CONSTRAINT "wiki_chunk_page_id_wiki_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_chunk" ADD CONSTRAINT "wiki_chunk_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_link" ADD CONSTRAINT "wiki_link_from_page_id_wiki_page_id_fkey" FOREIGN KEY ("from_page_id") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_author_bot_id_bot_id_fkey" FOREIGN KEY ("author_bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_page_team" ADD CONSTRAINT "wiki_page_team_page_id_wiki_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_page_team" ADD CONSTRAINT "wiki_page_team_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_score" CHECK ("score" between 0 and 100);
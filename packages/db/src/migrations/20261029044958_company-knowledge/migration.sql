CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "knowledge_chunk" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"doc_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"ord" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunk_doc_ord" UNIQUE("doc_id","ord")
);
--> statement-breakpoint
CREATE TABLE "knowledge_doc" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"source_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"web_view_link" text,
	"version" text DEFAULT '' NOT NULL,
	"modified_at" timestamp with time zone,
	"state" text DEFAULT 'indexed' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_doc_source_external" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_source" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"page_token" text,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_source_owner_provider" UNIQUE("owner_user_id","provider")
);
--> statement-breakpoint
CREATE INDEX "knowledge_chunk_owner_idx" ON "knowledge_chunk" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_search_idx" ON "knowledge_chunk" USING gin (to_tsvector('simple', f_unaccent("text")));--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embedding_idx" ON "knowledge_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_doc_owner_idx" ON "knowledge_doc" ("owner_user_id","state");--> statement-breakpoint
CREATE INDEX "knowledge_source_due_idx" ON "knowledge_source" ("next_sync_at");--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_doc_id_knowledge_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "knowledge_doc"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "knowledge_doc" ADD CONSTRAINT "knowledge_doc_source_id_knowledge_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_source"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "knowledge_doc" ADD CONSTRAINT "knowledge_doc_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "wiki_page" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'note' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text DEFAULT 'user' NOT NULL,
	"updated_by_bot_id" uuid,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_owner_slug" UNIQUE("owner_user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "wiki_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"author" text NOT NULL,
	"bot_id" uuid,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_revision_page_version" UNIQUE("page_id","version")
);
--> statement-breakpoint
CREATE INDEX "wiki_page_owner_idx" ON "wiki_page" ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "wiki_page_search_idx" ON "wiki_page" USING gin (to_tsvector('simple', f_unaccent("title" || ' ' || "summary" || ' ' || "body")));--> statement-breakpoint
CREATE INDEX "wiki_page_embedding_idx" ON "wiki_page" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "wiki_revision_owner_idx" ON "wiki_revision" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_updated_by_bot_id_bot_id_fkey" FOREIGN KEY ("updated_by_bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_revision" ADD CONSTRAINT "wiki_revision_page_id_wiki_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_revision" ADD CONSTRAINT "wiki_revision_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_revision" ADD CONSTRAINT "wiki_revision_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_revision" ADD CONSTRAINT "wiki_revision_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
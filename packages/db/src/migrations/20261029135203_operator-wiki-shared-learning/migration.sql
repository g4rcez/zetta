CREATE TABLE "wiki_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"bot_id" uuid,
	"conversation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wiki_source" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"seen_version" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_source_page_ref" UNIQUE("page_id","kind","ref")
);
--> statement-breakpoint
CREATE TABLE "wiki_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL,
	"page_owner_user_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"bot_id" uuid,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"base_version" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wiki_page" ADD COLUMN "scope" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_job_source_once" ON "wiki_job" ("kind","source","source_id") WHERE "source_id" is not null;--> statement-breakpoint
CREATE INDEX "wiki_job_due_idx" ON "wiki_job" ("status","run_after");--> statement-breakpoint
CREATE INDEX "wiki_job_owner_idx" ON "wiki_job" ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_page_shared_slug" ON "wiki_page" ("slug") WHERE "scope" = 'installation';--> statement-breakpoint
CREATE INDEX "wiki_source_check_idx" ON "wiki_source" ("status","checked_at");--> statement-breakpoint
CREATE INDEX "wiki_source_owner_idx" ON "wiki_source" ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_suggestion_open_once" ON "wiki_suggestion" ("page_id","author_user_id") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "wiki_suggestion_owner_idx" ON "wiki_suggestion" ("page_owner_user_id","status");--> statement-breakpoint
CREATE INDEX "wiki_suggestion_author_idx" ON "wiki_suggestion" ("author_user_id","status");--> statement-breakpoint
ALTER TABLE "wiki_job" ADD CONSTRAINT "wiki_job_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_job" ADD CONSTRAINT "wiki_job_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_job" ADD CONSTRAINT "wiki_job_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_source" ADD CONSTRAINT "wiki_source_page_id_wiki_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_source" ADD CONSTRAINT "wiki_source_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_suggestion" ADD CONSTRAINT "wiki_suggestion_page_id_wiki_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_suggestion" ADD CONSTRAINT "wiki_suggestion_page_owner_user_id_user_id_fkey" FOREIGN KEY ("page_owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_suggestion" ADD CONSTRAINT "wiki_suggestion_author_user_id_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "wiki_suggestion" ADD CONSTRAINT "wiki_suggestion_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
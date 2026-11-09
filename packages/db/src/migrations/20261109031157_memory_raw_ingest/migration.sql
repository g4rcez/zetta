CREATE TABLE "zetta"."memory_raw" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL CONSTRAINT "memory_raw_page" UNIQUE,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"origin" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_raw_owner_sha" UNIQUE("owner_user_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "zetta"."memory_job" ADD COLUMN "screen" jsonb;--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" ADD CONSTRAINT "memory_raw_page_id_memory_item_id_fkey" FOREIGN KEY ("page_id") REFERENCES "zetta"."memory_item"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_raw" ADD CONSTRAINT "memory_raw_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
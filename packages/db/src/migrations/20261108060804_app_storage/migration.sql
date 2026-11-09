CREATE TABLE "zetta"."app_record" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"app_id" uuid NOT NULL,
	"user_id" text,
	"collection" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_record_collection_check" CHECK ("collection" ~ '^[a-z][a-z0-9_-]{0,39}$'),
	CONSTRAINT "app_record_key_check" CHECK (length("key") between 1 and 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_record_key_idx" ON "zetta"."app_record" ("app_id",coalesce("user_id", ''),"collection","key");--> statement-breakpoint
CREATE INDEX "app_record_user_idx" ON "zetta"."app_record" ("app_id","user_id","collection");--> statement-breakpoint
ALTER TABLE "zetta"."app_record" ADD CONSTRAINT "app_record_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "zetta"."app"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_record" ADD CONSTRAINT "app_record_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
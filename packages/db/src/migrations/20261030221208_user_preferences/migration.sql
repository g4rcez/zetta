CREATE TABLE "user_preference" (
	"owner_user_id" text PRIMARY KEY,
	"rail_mode" text DEFAULT 'expanded' NOT NULL,
	"rail_width" integer DEFAULT 224 NOT NULL,
	"list_width" integer DEFAULT 320 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
CREATE TABLE "output_style" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"scope" text DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "output_style_name_check" CHECK (length(btrim("name")) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "output_style" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "output_style_id" uuid;--> statement-breakpoint
CREATE INDEX "output_style_owner_idx" ON "output_style" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "bot_output_style_id_idx" ON "bot" ("output_style_id");--> statement-breakpoint
ALTER TABLE "output_style" ADD CONSTRAINT "output_style_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_output_style_id_output_style_id_fkey" FOREIGN KEY ("output_style_id") REFERENCES "output_style"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_output_style_check" CHECK (("output_style" = 'custom') = ("output_style_id" is not null));
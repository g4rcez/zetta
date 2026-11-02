CREATE TABLE "zetta"."bot_skill" (
	"bot_id" uuid,
	"skill_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_skill_pkey" PRIMARY KEY("bot_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "zetta"."skill" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_repo" text,
	"source_path" text,
	"source_ref" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_name_check" CHECK ("name" ~ '^[a-z][a-z0-9-]*$' and length("name") <= 63),
	CONSTRAINT "skill_description_check" CHECK (length("description") <= 600)
);
--> statement-breakpoint
CREATE INDEX "bot_skill_skill_idx" ON "zetta"."bot_skill" ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_owner_name_active" ON "zetta"."skill" ("owner_user_id","name") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "skill_owner_idx" ON "zetta"."skill" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "zetta"."bot_skill" ADD CONSTRAINT "bot_skill_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_skill" ADD CONSTRAINT "bot_skill_skill_id_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "zetta"."skill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill" ADD CONSTRAINT "skill_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
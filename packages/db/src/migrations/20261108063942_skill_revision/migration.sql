CREATE TABLE "zetta"."skill_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"files_hash" text DEFAULT '' NOT NULL,
	"saved_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zetta"."skill" ADD COLUMN "source_state" text DEFAULT 'pristine' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_revision_skill_version_idx" ON "zetta"."skill_revision" ("skill_id","version");--> statement-breakpoint
CREATE INDEX "skill_revision_skill_idx" ON "zetta"."skill_revision" ("skill_id","created_at");--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" ADD CONSTRAINT "skill_revision_skill_id_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "zetta"."skill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_revision" ADD CONSTRAINT "skill_revision_saved_by_user_id_user_id_fkey" FOREIGN KEY ("saved_by_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
-- A GitHub skill that was saved after install may hold the owner's changes: treat it as edited, so an update asks first.
UPDATE "zetta"."skill" SET "source_state" = 'edited' WHERE "source" = 'github' AND "version" > 1;--> statement-breakpoint
-- History starts with what each skill is now.
INSERT INTO "zetta"."skill_revision" ("skill_id", "version", "name", "description", "body", "files_hash", "saved_by_user_id", "created_at")
SELECT s."id", s."version", s."name", s."description", s."body",
  md5(coalesce((SELECT string_agg(f."path" || ':' || f."size" || ':' || f."mode", ',' ORDER BY f."path") FROM "zetta"."skill_file" f WHERE f."skill_id" = s."id"), '')),
  s."owner_user_id", s."updated_at"
FROM "zetta"."skill" s;

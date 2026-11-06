CREATE TABLE "zetta"."skill_file" (
	"skill_id" uuid,
	"path" text,
	"content" bytea NOT NULL,
	"mode" text DEFAULT 'file' NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_file_pkey" PRIMARY KEY("skill_id","path"),
	CONSTRAINT "skill_file_path_check" CHECK ("path" <> 'SKILL.md' and "path" !~ '^/' and "path" !~ '(^|/)\.\.(/|$)' and length("path") <= 300)
);
--> statement-breakpoint
ALTER TABLE "zetta"."skill" ADD COLUMN "files_status" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
UPDATE "zetta"."skill" SET "files_status" = 'pending' WHERE "source" = 'github' AND "source_repo" IS NOT NULL AND "source_path" IS NOT NULL AND "source_ref" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."skill_file" ADD CONSTRAINT "skill_file_skill_id_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "zetta"."skill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "zetta"."team_person" (
	"team_id" uuid,
	"user_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	"activation_revision" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_person_pkey" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "team_person_user_id_idx" ON "zetta"."team_person" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_person_one_owner" ON "zetta"."team_person" ("team_id") WHERE "role" = 'owner';--> statement-breakpoint
ALTER TABLE "zetta"."team_person" ADD CONSTRAINT "team_person_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "zetta"."team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."team_person" ADD CONSTRAINT "team_person_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
INSERT INTO "zetta"."team_person" ("team_id", "user_id", "role", "activation_revision")
SELECT t."id", t."owner_user_id", 'owner', COALESCE(m."activation_revision", 1)
FROM "zetta"."team" t
LEFT JOIN "zetta"."membership" m ON m."user_id" = t."owner_user_id";

CREATE TABLE "team_role" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"icon" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_role_name_check" CHECK (length(btrim("name")) between 1 and 60),
	CONSTRAINT "team_role_description_check" CHECK (length("description") <= 200)
);
--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "role_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "team_role_owner_name_unique" ON "team_role" ("owner_user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_role_id_team_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "team_role"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "team_role" ADD CONSTRAINT "team_role_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
-- Old free-text roles become catalog entries (name = first 60 characters, description = the full text) and members point at them.
-- The old team_member.role column stays: nothing is lost, and a later migration can drop it.
INSERT INTO "team_role" ("owner_user_id", "name", "description")
SELECT DISTINCT ON (t."owner_user_id", lower(left(btrim(m."role"), 60)))
  t."owner_user_id", left(btrim(m."role"), 60), left(btrim(m."role"), 200)
FROM "team_member" m JOIN "team" t ON t."id" = m."team_id"
WHERE btrim(m."role") <> ''
ORDER BY t."owner_user_id", lower(left(btrim(m."role"), 60)), m."joined_at"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "team_member" m SET "role_id" = r."id"
FROM "team" t, "team_role" r
WHERE t."id" = m."team_id" AND r."owner_user_id" = t."owner_user_id"
  AND lower(r."name") = lower(left(btrim(m."role"), 60)) AND btrim(m."role") <> '';--> statement-breakpoint
-- The suggested roles for every existing user. New users get them on their first roles request.
INSERT INTO "team_role" ("owner_user_id", "name", "description", "color", "icon")
SELECT u."id", d."name", d."description", d."color", d."icon"
FROM "user" u CROSS JOIN (VALUES
  ('Researcher', 'Finds and checks sources', 'blue', 'magnifying-glass'),
  ('Developer', 'Writes and changes code', 'green', 'code'),
  ('Writer', 'Drafts and edits text', 'violet', 'pencil'),
  ('Reviewer', 'Checks the work of others', 'amber', 'check-circle'),
  ('Designer', 'Shapes the look and the flow', 'pink', 'palette'),
  ('Analyst', 'Reads data and reports findings', 'teal', 'chart-bar'),
  ('Tester', 'Looks for bugs and regressions', 'red', 'bug'),
  ('Planner', 'Splits goals into steps', 'orange', 'compass')
) AS d("name", "description", "color", "icon")
ON CONFLICT DO NOTHING;

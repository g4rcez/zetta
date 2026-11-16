CREATE TABLE "zetta"."project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"done_when" text DEFAULT '' NOT NULL,
	"not_included" text DEFAULT '' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"watch" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_name_check" CHECK (length(btrim("name")) between 1 and 120),
	CONSTRAINT "project_brief_check" CHECK (length("outcome") <= 1000 and length("audience") <= 1000 and length("done_when") <= 1000 and length("not_included") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "zetta"."project_member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bot_id" uuid,
	"user_id" text,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_kind_check" CHECK (("kind" = 'bot' and "bot_id" is not null and "user_id" is null and "team_id" is null) or ("kind" = 'person' and "user_id" is not null and "team_id" is not null and "bot_id" is null))
);
--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD COLUMN "project_id" uuid;--> statement-breakpoint
CREATE INDEX "discussion_project_id_idx" ON "zetta"."discussion" ("project_id");--> statement-breakpoint
CREATE INDEX "project_owner_idx" ON "zetta"."project" ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_owner_name_unique" ON "zetta"."project" ("owner_user_id",lower("name")) WHERE "status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_bot_unique" ON "zetta"."project_member" ("project_id","bot_id") WHERE "kind" = 'bot';--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_person_unique" ON "zetta"."project_member" ("project_id","user_id") WHERE "kind" = 'person';--> statement-breakpoint
CREATE INDEX "project_member_bot_id_idx" ON "zetta"."project_member" ("bot_id");--> statement-breakpoint
CREATE INDEX "project_member_user_id_idx" ON "zetta"."project_member" ("user_id");--> statement-breakpoint
CREATE INDEX "project_member_team_id_idx" ON "zetta"."project_member" ("team_id");--> statement-breakpoint
CREATE INDEX "task_project_idx" ON "zetta"."task" ("project_id","status");--> statement-breakpoint
ALTER TABLE "zetta"."discussion" ADD CONSTRAINT "discussion_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zetta"."project"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project" ADD CONSTRAINT "project_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ADD CONSTRAINT "project_member_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zetta"."project"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ADD CONSTRAINT "project_member_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ADD CONSTRAINT "project_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."project_member" ADD CONSTRAINT "project_member_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "zetta"."team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."task" ADD CONSTRAINT "task_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zetta"."project"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
CREATE TABLE "zetta"."org_chart" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text DEFAULT 'Company' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zetta"."org_position" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"chart_id" uuid NOT NULL,
	"parent_id" uuid,
	"rank" text DEFAULT 'member' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"team_id" uuid,
	"seat" text DEFAULT 'open' NOT NULL,
	"user_id" text,
	"bot_id" uuid,
	"template_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_position_title_check" CHECK (length(btrim("title")) between 1 and 80),
	CONSTRAINT "org_position_unit_check" CHECK (length("unit") <= 80),
	CONSTRAINT "org_position_description_check" CHECK (length("description") <= 600),
	CONSTRAINT "org_position_root_is_ceo_check" CHECK (("parent_id" is null) = ("rank" = 'ceo')),
	CONSTRAINT "org_position_seat_check" CHECK (("seat" = 'open' and "user_id" is null and "bot_id" is null) or ("seat" = 'person' and "user_id" is not null and "bot_id" is null) or ("seat" = 'bot' and "bot_id" is not null and "user_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_position_one_root" ON "zetta"."org_position" ("chart_id") WHERE "parent_id" is null;--> statement-breakpoint
CREATE INDEX "org_position_parent_id_idx" ON "zetta"."org_position" ("parent_id");--> statement-breakpoint
CREATE INDEX "org_position_user_id_idx" ON "zetta"."org_position" ("user_id");--> statement-breakpoint
CREATE INDEX "org_position_bot_id_idx" ON "zetta"."org_position" ("bot_id");--> statement-breakpoint
CREATE INDEX "org_position_team_id_idx" ON "zetta"."org_position" ("team_id");--> statement-breakpoint
ALTER TABLE "zetta"."org_chart" ADD CONSTRAINT "org_chart_updated_by_user_id_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD CONSTRAINT "org_position_chart_id_org_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "zetta"."org_chart"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD CONSTRAINT "org_position_parent_id_org_position_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "zetta"."org_position"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD CONSTRAINT "org_position_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "zetta"."team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD CONSTRAINT "org_position_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."org_position" ADD CONSTRAINT "org_position_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
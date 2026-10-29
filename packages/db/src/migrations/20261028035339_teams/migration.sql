CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"canvas" jsonb DEFAULT '{"x":0,"y":0,"w":360,"h":280}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_name_check" CHECK (length(btrim("name")) between 1 and 80),
	CONSTRAINT "team_goal_check" CHECK (length("goal") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"team_id" uuid,
	"bot_id" uuid,
	"kind" text DEFAULT 'member' NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"canvas" jsonb DEFAULT '{"x":0,"y":0}' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_pkey" PRIMARY KEY("team_id","bot_id"),
	CONSTRAINT "team_member_role_check" CHECK (length("role") <= 200)
);
--> statement-breakpoint
CREATE TABLE "turn_step" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"discussion_turn_id" uuid NOT NULL UNIQUE,
	"bot_id" uuid NOT NULL,
	"message_id" uuid,
	"data" jsonb DEFAULT '{"steps":[]}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_step_data_check" CHECK (jsonb_typeof("data") = 'object' and jsonb_typeof("data" -> 'steps') = 'array')
);
--> statement-breakpoint
ALTER TABLE "discussion" ADD COLUMN "team_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "team_owner_name_unique" ON "team" ("owner_user_id",lower("name")) WHERE "archived" = false;--> statement-breakpoint
CREATE INDEX "team_member_bot_id_idx" ON "team_member" ("bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_one_chief" ON "team_member" ("team_id") WHERE "kind" = 'chief';--> statement-breakpoint
CREATE INDEX "discussion_team_id_idx" ON "discussion" ("team_id");--> statement-breakpoint
CREATE INDEX "turn_step_bot_id_idx" ON "turn_step" ("bot_id");--> statement-breakpoint
CREATE INDEX "turn_step_message_id_idx" ON "turn_step" ("message_id");--> statement-breakpoint
CREATE INDEX "turn_step_owner_user_id_idx" ON "turn_step" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "turn_step" ADD CONSTRAINT "turn_step_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "turn_step" ADD CONSTRAINT "turn_step_discussion_turn_id_discussion_turn_id_fkey" FOREIGN KEY ("discussion_turn_id") REFERENCES "discussion_turn"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "turn_step" ADD CONSTRAINT "turn_step_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "turn_step" ADD CONSTRAINT "turn_step_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
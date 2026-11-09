CREATE TABLE "zetta"."app" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_playground_id" uuid,
	"active_version_id" uuid,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_slug_check" CHECK ("slug" ~ '^[a-z][a-z0-9-]{0,39}$'),
	CONSTRAINT "app_name_check" CHECK (length(btrim("name")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "zetta"."app_call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"app_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"bot_id" uuid,
	"conversation_id" uuid,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"proposal_id" uuid,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zetta"."app_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"app_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"entry" text NOT NULL,
	"files" jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"published_by_user_id" text NOT NULL,
	"published_by_bot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_version_note_check" CHECK (length("note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "zetta"."bot_app" (
	"bot_id" uuid,
	"app_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_app_pkey" PRIMARY KEY("bot_id","app_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_owner_slug_active_idx" ON "zetta"."app" ("owner_user_id","slug") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "app_owner_idx" ON "zetta"."app" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "app_call_app_idx" ON "zetta"."app_call" ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "app_call_actor_idx" ON "zetta"."app_call" ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "app_call_proposal_idx" ON "zetta"."app_call" ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_version_app_n_idx" ON "zetta"."app_version" ("app_id","n");--> statement-breakpoint
CREATE INDEX "bot_app_app_idx" ON "zetta"."bot_app" ("app_id");--> statement-breakpoint
ALTER TABLE "zetta"."app" ADD CONSTRAINT "app_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app" ADD CONSTRAINT "app_source_playground_id_playground_id_fkey" FOREIGN KEY ("source_playground_id") REFERENCES "zetta"."playground"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app" ADD CONSTRAINT "app_active_version_id_app_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "zetta"."app_version"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "zetta"."app"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_version_id_app_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "zetta"."app_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_call" ADD CONSTRAINT "app_call_proposal_id_config_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "zetta"."config_proposal"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_version" ADD CONSTRAINT "app_version_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "zetta"."app"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_version" ADD CONSTRAINT "app_version_published_by_user_id_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."app_version" ADD CONSTRAINT "app_version_published_by_bot_id_bot_id_fkey" FOREIGN KEY ("published_by_bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_app" ADD CONSTRAINT "bot_app_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot_app" ADD CONSTRAINT "bot_app_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "zetta"."app"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
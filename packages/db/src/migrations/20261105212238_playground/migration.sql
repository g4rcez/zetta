CREATE TABLE "zetta"."playground" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"runner" text DEFAULT 'host' NOT NULL,
	"entry" text NOT NULL,
	"inputs" jsonb DEFAULT '[]' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_bot_id" uuid,
	"conversation_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playground_title_check" CHECK (length(btrim("title")) between 1 and 120),
	CONSTRAINT "playground_entry_check" CHECK (length("entry") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "zetta"."playground_file" (
	"playground_id" uuid,
	"path" text,
	"content" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playground_file_pkey" PRIMARY KEY("playground_id","path"),
	CONSTRAINT "playground_file_path_check" CHECK ("path" !~ '^/' and "path" !~ '(^|/)\.\.(/|$)' and "path" !~ '^out(/|$)' and length("path") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "zetta"."playground_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"playground_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"bot_id" uuid,
	"runner" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"runtime_version" text DEFAULT '' NOT NULL,
	"entry" text NOT NULL,
	"files" jsonb NOT NULL,
	"inputs" jsonb DEFAULT '{}' NOT NULL,
	"exit_code" integer,
	"stdout" text DEFAULT '' NOT NULL,
	"stderr" text DEFAULT '' NOT NULL,
	"output" text DEFAULT 'complete' NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zetta"."playground_run_output" (
	"run_id" uuid,
	"path" text,
	"content" bytea NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	CONSTRAINT "playground_run_output_pkey" PRIMARY KEY("run_id","path"),
	CONSTRAINT "playground_run_output_path_check" CHECK ("path" !~ '^/' and "path" !~ '(^|/)\.\.(/|$)' and length("path") between 1 and 300)
);
--> statement-breakpoint
CREATE INDEX "playground_owner_idx" ON "zetta"."playground" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "playground_run_playground_idx" ON "zetta"."playground_run" ("playground_id","started_at");--> statement-breakpoint
ALTER TABLE "zetta"."playground" ADD CONSTRAINT "playground_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground" ADD CONSTRAINT "playground_created_by_bot_id_bot_id_fkey" FOREIGN KEY ("created_by_bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground" ADD CONSTRAINT "playground_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_file" ADD CONSTRAINT "playground_file_playground_id_playground_id_fkey" FOREIGN KEY ("playground_id") REFERENCES "zetta"."playground"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ADD CONSTRAINT "playground_run_playground_id_playground_id_fkey" FOREIGN KEY ("playground_id") REFERENCES "zetta"."playground"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ADD CONSTRAINT "playground_run_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run" ADD CONSTRAINT "playground_run_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."playground_run_output" ADD CONSTRAINT "playground_run_output_run_id_playground_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "zetta"."playground_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
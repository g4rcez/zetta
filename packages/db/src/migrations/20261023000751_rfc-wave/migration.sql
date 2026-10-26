CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"bot_id" uuid,
	"subject_id" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_connection" (
	"bot_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"key" text NOT NULL,
	"connection_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_connection_unique" UNIQUE("bot_id","owner_user_id","key")
);
--> statement-breakpoint
CREATE TABLE "browser_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'shared' NOT NULL,
	"bot_id" uuid,
	"revoked_at" timestamp with time zone,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_profile_unique" UNIQUE("owner_user_id","name")
);
--> statement-breakpoint
CREATE TABLE "decision_config" (
	"bot_id" uuid PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"min_confidence_pct" integer DEFAULT 50 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"parent_message_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"status" text NOT NULL,
	"result_message_id" uuid,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_version_unique" UNIQUE("workflow_id","version")
);
--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "required_connections" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "config_proposal" ADD COLUMN "base_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hook" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction" ADD COLUMN "trigger" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction" ADD COLUMN "verification" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction" ADD COLUMN "content_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "category" text DEFAULT 'fact' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "content_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "kind" text DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "conversation_mode" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "routine" ADD COLUMN "once_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routine_run" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "routine_run" ADD COLUMN "occurrence_key" text;--> statement-breakpoint
ALTER TABLE "routine_run" ADD COLUMN "trigger" text DEFAULT 'schedule' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN "content_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN "source_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routine_run" ALTER COLUMN "finished_at" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_owner_idx" ON "audit_event" ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "delegation_conv_idx" ON "delegation" ("conversation_id","parent_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_owner_hash" ON "instruction" ("owner_user_id","content_hash") WHERE "content_hash" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "memory_owner_hash" ON "memory" ("owner_user_id","content_hash") WHERE "content_hash" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "routine_run_occurrence" ON "routine_run" ("routine_id","occurrence_key") WHERE "occurrence_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_request" ON "snapshot" ("owner_user_id","request_key") WHERE "request_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_request" ON "workflow_run" ("workflow_id","request_key") WHERE "request_key" is not null;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_connection" ADD CONSTRAINT "bot_connection_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_connection" ADD CONSTRAINT "bot_connection_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "browser_profile" ADD CONSTRAINT "browser_profile_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "browser_profile" ADD CONSTRAINT "browser_profile_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "decision_config" ADD CONSTRAINT "decision_config_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "decision_config" ADD CONSTRAINT "decision_config_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_parent_message_id_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "message"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_workflow_id_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
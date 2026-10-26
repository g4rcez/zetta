CREATE TABLE "bot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"visibility" text NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"harness" text DEFAULT 'fixture' NOT NULL,
	"model" text,
	"personality" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_chief_private_check" CHECK ("kind" <> 'chief' or "visibility" = 'private'),
	CONSTRAINT "bot_name_check" CHECK (length(btrim("name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"conversation_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_conversation_seq_unique" UNIQUE("conversation_id","seq"),
	CONSTRAINT "message_content_check" CHECK (length("content") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_owner_name_unique" UNIQUE("owner_user_id","name"),
	CONSTRAINT "workspace_name_check" CHECK (length(btrim("name")) between 1 and 80)
);
--> statement-breakpoint
CREATE INDEX "bot_owner_idx" ON "bot" ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_one_chief_per_owner" ON "bot" ("owner_user_id") WHERE "kind" = 'chief';--> statement-breakpoint
CREATE INDEX "conversation_owner_idx" ON "conversation" ("owner_user_id","updated_at");--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "bot_peer" (
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"peer_bot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_peer_unique" UNIQUE("owner_user_id","bot_id","peer_bot_id"),
	CONSTRAINT "bot_peer_self_check" CHECK ("bot_id" <> "peer_bot_id")
);
--> statement-breakpoint
CREATE TABLE "discussion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL UNIQUE,
	"created_by_bot_id" uuid,
	"origin_conversation_id" uuid,
	"origin_message_id" uuid,
	"origin_inbound" jsonb,
	"title" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"context_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"tainted" boolean DEFAULT false NOT NULL,
	"turn_budget" integer DEFAULT 20 NOT NULL,
	"turns_used" integer DEFAULT 0 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"open_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "discussion_title_check" CHECK (length(btrim("title")) between 1 and 120),
	CONSTRAINT "discussion_context_check" CHECK (length("context") <= 8000 and length("goal") <= 1000),
	CONSTRAINT "discussion_budget_check" CHECK ("turn_budget" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "discussion_member" (
	"discussion_id" uuid,
	"bot_id" uuid,
	"role" text DEFAULT '' NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discussion_member_pkey" PRIMARY KEY("discussion_id","bot_id"),
	CONSTRAINT "discussion_member_role_check" CHECK (length("role") <= 200)
);
--> statement-breakpoint
CREATE TABLE "discussion_turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"discussion_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"trigger_message_id" uuid,
	"kind" text DEFAULT 'reply' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"approved_context_version" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reason_code" text,
	"result_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbound_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"route_id" uuid NOT NULL,
	"thread_id" uuid,
	"key" text NOT NULL,
	"chat_key" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_event_key" UNIQUE("route_id","key"),
	CONSTRAINT "inbound_event_text_check" CHECK (length("text") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "inbound_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"filter" jsonb DEFAULT '{"direct":true,"groups":false,"chats":[]}' NOT NULL,
	"cursor" jsonb,
	"poll_every_seconds" integer DEFAULT 60 NOT NULL,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_route_owner_plugin" UNIQUE("owner_user_id","plugin_id"),
	CONSTRAINT "inbound_route_interval_check" CHECK ("poll_every_seconds" >= 20)
);
--> statement-breakpoint
CREATE TABLE "inbound_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"route_id" uuid NOT NULL,
	"chat_key" text NOT NULL,
	"chat_name" text DEFAULT '' NOT NULL,
	"conversation_id" uuid NOT NULL UNIQUE,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_thread_chat" UNIQUE("route_id","chat_key")
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
CREATE INDEX "discussion_owner_idx" ON "discussion" ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_open_key" ON "discussion" ("owner_user_id","open_key") WHERE "status" in ('open', 'paused', 'stalled');--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_turn_wake_unique" ON "discussion_turn" ("discussion_id","bot_id","trigger_message_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_turn_one_running" ON "discussion_turn" ("discussion_id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "discussion_turn_status_idx" ON "discussion_turn" ("status","created_at");--> statement-breakpoint
CREATE INDEX "inbound_event_status_idx" ON "inbound_event" ("status","created_at");--> statement-breakpoint
CREATE INDEX "inbound_route_due_idx" ON "inbound_route" ("enabled","next_poll_at");--> statement-breakpoint
ALTER TABLE "bot_peer" ADD CONSTRAINT "bot_peer_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_peer" ADD CONSTRAINT "bot_peer_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_peer" ADD CONSTRAINT "bot_peer_peer_bot_id_bot_id_fkey" FOREIGN KEY ("peer_bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_created_by_bot_id_bot_id_fkey" FOREIGN KEY ("created_by_bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_origin_conversation_id_conversation_id_fkey" FOREIGN KEY ("origin_conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_origin_message_id_message_id_fkey" FOREIGN KEY ("origin_message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion_member" ADD CONSTRAINT "discussion_member_discussion_id_discussion_id_fkey" FOREIGN KEY ("discussion_id") REFERENCES "discussion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion_member" ADD CONSTRAINT "discussion_member_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion_turn" ADD CONSTRAINT "discussion_turn_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion_turn" ADD CONSTRAINT "discussion_turn_discussion_id_discussion_id_fkey" FOREIGN KEY ("discussion_id") REFERENCES "discussion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "discussion_turn" ADD CONSTRAINT "discussion_turn_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_route_id_inbound_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "inbound_route"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_thread_id_inbound_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "inbound_thread"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_route" ADD CONSTRAINT "inbound_route_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_route" ADD CONSTRAINT "inbound_route_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_route_id_inbound_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "inbound_route"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
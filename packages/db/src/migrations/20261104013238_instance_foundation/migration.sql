CREATE TABLE "zetta"."rate_limit" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zetta"."server_instance" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"version" text,
	"internal_url" text,
	"capabilities" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zetta"."transport_key" (
	"kid" text PRIMARY KEY,
	"public_jwk" jsonb NOT NULL,
	"private_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zetta"."chat_queue" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."goal_loop" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."message" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."workflow_run" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."discussion_turn" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."inbound_event" ADD COLUMN "owner_instance" uuid;--> statement-breakpoint
-- One running queue row per conversation from now on: keep the oldest running row, put any other back to pending (it is answered later).
UPDATE "zetta"."chat_queue" q SET "status" = 'pending'
WHERE q."status" = 'running' AND EXISTS (
	SELECT 1 FROM "zetta"."chat_queue" r
	WHERE r."conversation_id" = q."conversation_id" AND r."status" = 'running'
		AND (r."created_at", r."id") < (q."created_at", q."id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "chat_queue_one_running" ON "zetta"."chat_queue" ("conversation_id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "message_running_idx" ON "zetta"."message" ("owner_user_id","author_bot_id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "audit_harness_run_last_idx" ON "zetta"."audit_event" ("owner_user_id","bot_id","created_at" DESC NULLS LAST) WHERE "kind" = 'harness_run';--> statement-breakpoint
CREATE INDEX "server_instance_live_idx" ON "zetta"."server_instance" ("heartbeat_at") WHERE "stopped_at" is null;--> statement-breakpoint
CREATE INDEX "server_instance_name_idx" ON "zetta"."server_instance" ("name");
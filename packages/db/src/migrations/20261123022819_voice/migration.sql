CREATE TABLE "zetta"."voice_call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"number_id" uuid,
	"channel" text DEFAULT 'web' NOT NULL,
	"direction" text DEFAULT 'in' NOT NULL,
	"peer" text,
	"trust" text DEFAULT 'owner' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"end_reason" text,
	"language" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"owner_instance" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_call_channel_check" CHECK ("channel" in ('web', 'phone')),
	CONSTRAINT "voice_call_direction_check" CHECK ("direction" in ('in', 'out')),
	CONSTRAINT "voice_call_trust_check" CHECK ("trust" in ('owner', 'outside')),
	CONSTRAINT "voice_call_status_check" CHECK ("status" in ('ringing', 'active', 'ended', 'failed', 'blocked')),
	CONSTRAINT "voice_call_end_reason_check" CHECK ("end_reason" is null or "end_reason" in ('hangup', 'disconnected', 'idle', 'time_limit', 'replaced', 'restart', 'error', 'refused')),
	CONSTRAINT "voice_call_peer_check" CHECK ("peer" is null or length("peer") <= 32),
	CONSTRAINT "voice_call_language_check" CHECK ("language" is null or length("language") <= 35),
	CONSTRAINT "voice_call_duration_check" CHECK ("duration_seconds" is null or "duration_seconds" >= 0),
	CONSTRAINT "voice_call_ended_check" CHECK (("status" in ('ringing', 'active')) = ("ended_at" is null))
);
--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "voice" text;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD COLUMN "voice_language" text;--> statement-breakpoint
CREATE INDEX "voice_call_owner_idx" ON "zetta"."voice_call" ("owner_user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voice_call_conversation_idx" ON "zetta"."voice_call" ("conversation_id");--> statement-breakpoint
CREATE INDEX "voice_call_bot_idx" ON "zetta"."voice_call" ("bot_id");--> statement-breakpoint
CREATE INDEX "voice_call_open_idx" ON "zetta"."voice_call" ("owner_instance","owner_user_id") WHERE "status" in ('ringing', 'active');--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD CONSTRAINT "voice_call_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD CONSTRAINT "voice_call_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ADD CONSTRAINT "voice_call_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_voice_check" CHECK ("voice" is null or length("voice") <= 100);--> statement-breakpoint
ALTER TABLE "zetta"."bot" ADD CONSTRAINT "bot_voice_language_check" CHECK ("voice_language" is null or length("voice_language") <= 35);
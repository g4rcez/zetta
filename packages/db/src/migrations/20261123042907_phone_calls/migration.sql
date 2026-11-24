CREATE TABLE "zetta"."phone_webhook_event" (
	"event_id" text PRIMARY KEY,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_webhook_event_id_check" CHECK (length("event_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "zetta"."voice_call" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "phone_webhook_event_seen_idx" ON "zetta"."phone_webhook_event" ("seen_at");
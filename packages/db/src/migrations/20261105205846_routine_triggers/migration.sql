CREATE TABLE "zetta"."routine_trigger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"routine_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"secret_hash" text,
	"filter" jsonb DEFAULT '{}' NOT NULL,
	"cursor" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"next_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" ADD COLUMN "trigger_id" uuid;--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" ADD COLUMN "event" jsonb;--> statement-breakpoint
CREATE INDEX "routine_run_trigger_id_idx" ON "zetta"."routine_run" ("trigger_id","started_at");--> statement-breakpoint
CREATE INDEX "routine_trigger_routine_id_idx" ON "zetta"."routine_trigger" ("routine_id");--> statement-breakpoint
CREATE INDEX "routine_trigger_owner_user_id_idx" ON "zetta"."routine_trigger" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "routine_trigger_poll_idx" ON "zetta"."routine_trigger" ("next_poll_at") WHERE "status" = 'active' and "kind" <> 'webhook';--> statement-breakpoint
ALTER TABLE "zetta"."routine_run" ADD CONSTRAINT "routine_run_trigger_id_routine_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "zetta"."routine_trigger"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."routine_trigger" ADD CONSTRAINT "routine_trigger_routine_id_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "zetta"."routine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."routine_trigger" ADD CONSTRAINT "routine_trigger_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
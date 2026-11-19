CREATE TABLE "zetta"."item_use" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"ref_kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"exposure" text NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zetta"."reply_outcome" (
	"message_id" uuid PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"signals" text[] DEFAULT '{}'::text[] NOT NULL,
	"weight" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "reply_outcome_signals_check" CHECK ("signals" <@ ARRAY['thumbs_up','thumbs_down','stopped','steered','corrected','task_done','carried_on','send_now','interrupted','chose_better']::text[]),
	CONSTRAINT "reply_outcome_weight_check" CHECK ("weight" between -20 and 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "item_use_reply_ref_unique" ON "zetta"."item_use" ("message_id","ref_kind","ref_id");--> statement-breakpoint
CREATE INDEX "item_use_ref_idx" ON "zetta"."item_use" ("ref_kind","ref_id","created_at");--> statement-breakpoint
CREATE INDEX "item_use_bot_idx" ON "zetta"."item_use" ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "item_use_created_idx" ON "zetta"."item_use" ("created_at");--> statement-breakpoint
CREATE INDEX "reply_outcome_bot_idx" ON "zetta"."reply_outcome" ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "reply_outcome_pending_idx" ON "zetta"."reply_outcome" ("created_at") WHERE "outcome" = 'pending';--> statement-breakpoint
ALTER TABLE "zetta"."item_use" ADD CONSTRAINT "item_use_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."item_use" ADD CONSTRAINT "item_use_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."item_use" ADD CONSTRAINT "item_use_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."item_use" ADD CONSTRAINT "item_use_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" ADD CONSTRAINT "reply_outcome_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" ADD CONSTRAINT "reply_outcome_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."reply_outcome" ADD CONSTRAINT "reply_outcome_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
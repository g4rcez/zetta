CREATE TABLE "zetta"."message_pin" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL CONSTRAINT "message_pin_message_unique" UNIQUE,
	"pinned_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "message_pin_conversation_idx" ON "zetta"."message_pin" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "message_pin_pinned_by_user_id_idx" ON "zetta"."message_pin" ("pinned_by_user_id");--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" ADD CONSTRAINT "message_pin_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "zetta"."conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" ADD CONSTRAINT "message_pin_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."message_pin" ADD CONSTRAINT "message_pin_pinned_by_user_id_user_id_fkey" FOREIGN KEY ("pinned_by_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
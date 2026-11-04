CREATE TABLE "zetta"."machine_bot" (
	"machine_id" uuid,
	"bot_id" uuid,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_bot_pkey" PRIMARY KEY("machine_id","bot_id")
);
--> statement-breakpoint
CREATE INDEX "machine_bot_bot_id_idx" ON "zetta"."machine_bot" ("bot_id");--> statement-breakpoint
CREATE INDEX "machine_bot_owner_idx" ON "zetta"."machine_bot" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "zetta"."machine_bot" ADD CONSTRAINT "machine_bot_machine_id_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "zetta"."machine"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."machine_bot" ADD CONSTRAINT "machine_bot_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."machine_bot" ADD CONSTRAINT "machine_bot_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
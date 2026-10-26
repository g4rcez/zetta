CREATE TABLE "computer_vm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_by_bot_id" uuid,
	"purpose" text,
	"status" text DEFAULT 'stopped' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_started_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "computer_vm_owner_idx" ON "computer_vm" ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_vm_default_unique" ON "computer_vm" ("owner_user_id") WHERE "kind" = 'default' and "status" <> 'deleted';--> statement-breakpoint
ALTER TABLE "computer_vm" ADD CONSTRAINT "computer_vm_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "computer_vm" ADD CONSTRAINT "computer_vm_created_by_bot_id_bot_id_fkey" FOREIGN KEY ("created_by_bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
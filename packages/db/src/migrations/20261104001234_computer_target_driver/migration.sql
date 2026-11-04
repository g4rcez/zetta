ALTER TABLE "zetta"."computer_vm" ADD COLUMN "target" text DEFAULT 'vm' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD COLUMN "driver" text DEFAULT 'cua' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "computer_vm_local_unique" ON "zetta"."computer_vm" ("owner_user_id") WHERE "target" = 'local' and "status" <> 'deleted';
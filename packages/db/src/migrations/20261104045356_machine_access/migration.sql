CREATE TABLE "zetta"."machine" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"username" text NOT NULL,
	"host_key" text,
	"connection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "machine_port_check" CHECK ("port" between 1 and 65535),
	CONSTRAINT "machine_host_key_check" CHECK ("kind" = 'ftp' or "host_key" is not null)
);
--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD COLUMN "endpoint" text;--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
CREATE INDEX "computer_vm_connection_id_idx" ON "zetta"."computer_vm" ("connection_id");--> statement-breakpoint
CREATE INDEX "machine_connection_id_idx" ON "zetta"."machine" ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_owner_name_unique" ON "zetta"."machine" ("owner_user_id","name") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD CONSTRAINT "computer_vm_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "zetta"."connection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."machine" ADD CONSTRAINT "machine_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."machine" ADD CONSTRAINT "machine_connection_id_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "zetta"."connection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."computer_vm" ADD CONSTRAINT "computer_vm_cua_check" CHECK (("target" = 'cua') = ("endpoint" is not null and "connection_id" is not null));
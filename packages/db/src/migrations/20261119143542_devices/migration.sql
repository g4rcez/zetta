CREATE TABLE "zetta"."device" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"credential_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "device_name_check" CHECK (length("name") between 1 and 60),
	CONSTRAINT "device_platform_check" CHECK ("platform" in ('darwin', 'linux', 'win32')),
	CONSTRAINT "device_credential_check" CHECK (length("credential_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "zetta"."device_bot" (
	"device_id" uuid,
	"bot_id" uuid,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_bot_pkey" PRIMARY KEY("device_id","bot_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "device_credential_hash_unique" ON "zetta"."device" ("credential_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "device_owner_name_unique" ON "zetta"."device" ("owner_user_id","name") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "device_owner_idx" ON "zetta"."device" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "device_bot_bot_id_idx" ON "zetta"."device_bot" ("bot_id");--> statement-breakpoint
CREATE INDEX "device_bot_owner_idx" ON "zetta"."device_bot" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "zetta"."device" ADD CONSTRAINT "device_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."device_bot" ADD CONSTRAINT "device_bot_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "zetta"."device"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."device_bot" ADD CONSTRAINT "device_bot_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."device_bot" ADD CONSTRAINT "device_bot_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
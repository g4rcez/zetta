CREATE TABLE "zetta"."connection" (
	"id" uuid PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"current_credential_version" integer NOT NULL,
	CONSTRAINT "connection_owner_kind_unique" UNIQUE("id","owner_user_id","kind"),
	CONSTRAINT "connection_kind_check" CHECK ("kind" = 'api-key'),
	CONSTRAINT "connection_provider_check" CHECK ("provider" collate "C" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "connection_label_check" CHECK (char_length("label") between 1 and 100 and octet_length("label") <= 400),
	CONSTRAINT "connection_revision_check" CHECK ("revision" between 1 and 2147483647),
	CONSTRAINT "connection_state_check" CHECK (("state" = 'active' and "revoked_at" is null) or ("state" = 'revoked' and "revoked_at" is not null)),
	CONSTRAINT "connection_owner_check" CHECK (octet_length("owner_user_id") between 1 and 256),
	CONSTRAINT "connection_version_check" CHECK ("current_credential_version" between 1 and 2147483647)
);
--> statement-breakpoint
CREATE TABLE "zetta"."connection_credential" (
	"connection_id" uuid,
	"credential_version" integer,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"envelope_version" integer NOT NULL,
	"algorithm" text NOT NULL,
	"key_id" text NOT NULL,
	"nonce" bytea NOT NULL,
	"tag" bytea NOT NULL,
	"ciphertext" bytea NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connection_credential_pkey" PRIMARY KEY("connection_id","credential_version"),
	CONSTRAINT "connection_credential_kind_check" CHECK ("kind" = 'api-key'),
	CONSTRAINT "connection_credential_version_check" CHECK ("credential_version" between 1 and 2147483647),
	CONSTRAINT "connection_credential_envelope_check" CHECK ("envelope_version" = 1 and "algorithm" = 'aes-256-gcm'),
	CONSTRAINT "connection_credential_key_id_check" CHECK ("key_id" collate "C" ~ '^[a-z0-9_-]{1,32}$'),
	CONSTRAINT "connection_credential_nonce_check" CHECK (octet_length("nonce") = 12),
	CONSTRAINT "connection_credential_tag_check" CHECK (octet_length("tag") = 16),
	CONSTRAINT "connection_credential_ciphertext_check" CHECK (octet_length("ciphertext") between 1 and 16384)
);
--> statement-breakpoint
CREATE TABLE "zetta"."connection_key_check" (
	"id" integer PRIMARY KEY,
	"envelope_version" integer NOT NULL,
	"algorithm" text NOT NULL,
	"key_id" text NOT NULL,
	"nonce" bytea NOT NULL,
	"tag" bytea NOT NULL,
	"ciphertext" bytea NOT NULL,
	"nonce_purpose" text NOT NULL,
	"encryption_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connection_key_check_singleton_check" CHECK ("id" = 1),
	CONSTRAINT "connection_key_check_purpose_check" CHECK ("nonce_purpose" = 'key-check'),
	CONSTRAINT "connection_key_check_count_check" CHECK ("encryption_count" between 1 and 1000000),
	CONSTRAINT "connection_key_check_envelope_check" CHECK ("envelope_version" = 1 and "algorithm" = 'aes-256-gcm'),
	CONSTRAINT "connection_key_check_key_id_check" CHECK ("key_id" collate "C" ~ '^[a-z0-9_-]{1,32}$'),
	CONSTRAINT "connection_key_check_nonce_check" CHECK (octet_length("nonce") = 12),
	CONSTRAINT "connection_key_check_tag_check" CHECK (octet_length("tag") = 16),
	CONSTRAINT "connection_key_check_ciphertext_check" CHECK (octet_length("ciphertext") between 1 and 16384)
);
--> statement-breakpoint
CREATE TABLE "zetta"."connection_mutation_receipt" (
	"owner_user_id" text,
	"operation_id" uuid,
	"operation" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"expected_revision" integer,
	"request_mac" bytea NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"credential_version" integer NOT NULL,
	CONSTRAINT "connection_mutation_receipt_pkey" PRIMARY KEY("owner_user_id","operation_id"),
	CONSTRAINT "connection_receipt_kind_check" CHECK ("kind" = 'api-key'),
	CONSTRAINT "connection_receipt_provider_check" CHECK ("provider" collate "C" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "connection_receipt_label_check" CHECK (char_length("label") between 1 and 100 and octet_length("label") <= 400),
	CONSTRAINT "connection_receipt_revision_check" CHECK ("revision" between 1 and 2147483647),
	CONSTRAINT "connection_receipt_state_check" CHECK (("state" = 'active' and "revoked_at" is null) or ("state" = 'revoked' and "revoked_at" is not null)),
	CONSTRAINT "connection_receipt_mac_check" CHECK (octet_length("request_mac") = 32),
	CONSTRAINT "connection_receipt_version_check" CHECK ("credential_version" between 1 and 2147483647),
	CONSTRAINT "connection_receipt_operation_check" CHECK (
    ("operation" = 'create-api-key' and "expected_revision" is null and "revision" = 1 and "credential_version" = 1 and "state" = 'active')
    or ("operation" in ('replace-api-key', 'revoke') and "expected_revision" is not null and "expected_revision" between 1 and 2147483646 and "revision" = "expected_revision" + 1
      and (("operation" = 'replace-api-key' and "state" = 'active') or ("operation" = 'revoke' and "state" = 'revoked')))
  )
);
--> statement-breakpoint
CREATE TABLE "zetta"."connection_nonce" (
	"key_id" text,
	"nonce" bytea,
	"purpose" text NOT NULL,
	"connection_id" uuid,
	"credential_version" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connection_nonce_pkey" PRIMARY KEY("key_id","nonce"),
	CONSTRAINT "connection_nonce_credential_unique" UNIQUE("key_id","nonce","connection_id","credential_version"),
	CONSTRAINT "connection_nonce_purpose_unique" UNIQUE("key_id","nonce","purpose"),
	CONSTRAINT "connection_nonce_key_id_check" CHECK ("key_id" collate "C" ~ '^[a-z0-9_-]{1,32}$'),
	CONSTRAINT "connection_nonce_length_check" CHECK (octet_length("nonce") = 12),
	CONSTRAINT "connection_nonce_identity_check" CHECK (
    ("purpose" = 'key-check' and "connection_id" is null and "credential_version" is null)
    or ("purpose" = 'credential' and "connection_id" is not null and "credential_version" is not null and "credential_version" between 1 and 2147483647)
  )
);
--> statement-breakpoint
CREATE INDEX "connection_owner_id_idx" ON "zetta"."connection" ("owner_user_id","id");--> statement-breakpoint
ALTER TABLE "zetta"."connection" ADD CONSTRAINT "connection_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection_credential" ADD CONSTRAINT "connection_credential_owner_fk" FOREIGN KEY ("connection_id","owner_user_id","kind") REFERENCES "zetta"."connection"("id","owner_user_id","kind") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection_credential" ADD CONSTRAINT "connection_credential_nonce_fk" FOREIGN KEY ("key_id","nonce","connection_id","credential_version") REFERENCES "zetta"."connection_nonce"("key_id","nonce","connection_id","credential_version") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection_key_check" ADD CONSTRAINT "connection_key_check_nonce_fk" FOREIGN KEY ("key_id","nonce","nonce_purpose") REFERENCES "zetta"."connection_nonce"("key_id","nonce","purpose") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."connection_mutation_receipt" ADD CONSTRAINT "connection_receipt_owner_fk" FOREIGN KEY ("connection_id","owner_user_id","kind") REFERENCES "zetta"."connection"("id","owner_user_id","kind") ON DELETE RESTRICT ON UPDATE RESTRICT;
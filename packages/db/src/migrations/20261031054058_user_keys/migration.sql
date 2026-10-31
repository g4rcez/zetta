CREATE TABLE "connection_user_key" (
	"owner_user_id" text PRIMARY KEY,
	"key_version" integer NOT NULL,
	"envelope_version" integer NOT NULL,
	"algorithm" text NOT NULL,
	"key_id" text NOT NULL,
	"nonce" bytea NOT NULL,
	"tag" bytea NOT NULL,
	"ciphertext" bytea NOT NULL,
	"nonce_purpose" text NOT NULL,
	"encryption_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connection_user_key_owner_check" CHECK (octet_length("owner_user_id") between 1 and 256),
	CONSTRAINT "connection_user_key_version_check" CHECK ("key_version" between 1 and 2147483647),
	CONSTRAINT "connection_user_key_purpose_check" CHECK ("nonce_purpose" = 'user-key'),
	CONSTRAINT "connection_user_key_count_check" CHECK ("encryption_count" between 0 and 1000000),
	CONSTRAINT "connection_user_key_envelope_check" CHECK ("envelope_version" = 1 and "algorithm" = 'aes-256-gcm'),
	CONSTRAINT "connection_user_key_key_id_check" CHECK ("key_id" collate "C" ~ '^[a-z0-9_-]{1,32}$'),
	CONSTRAINT "connection_user_key_nonce_check" CHECK (octet_length("nonce") = 12),
	CONSTRAINT "connection_user_key_tag_check" CHECK (octet_length("tag") = 16),
	CONSTRAINT "connection_user_key_ciphertext_check" CHECK (octet_length("ciphertext") between 1 and 16384)
);
--> statement-breakpoint
CREATE INDEX "connection_user_key_key_id_nonce_nonce_purpose_idx" ON "connection_user_key" ("key_id","nonce","nonce_purpose");--> statement-breakpoint
ALTER TABLE "connection_user_key" ADD CONSTRAINT "connection_user_key_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "connection_user_key" ADD CONSTRAINT "connection_user_key_nonce_fk" FOREIGN KEY ("key_id","nonce","nonce_purpose") REFERENCES "connection_nonce"("key_id","nonce","purpose") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "connection_nonce" DROP CONSTRAINT "connection_nonce_identity_check", ADD CONSTRAINT "connection_nonce_identity_check" CHECK (
    ("purpose" in ('key-check', 'user-key') and "connection_id" is null and "credential_version" is null)
    or ("purpose" = 'credential' and "connection_id" is not null and "credential_version" is not null and "credential_version" between 1 and 2147483647)
  );
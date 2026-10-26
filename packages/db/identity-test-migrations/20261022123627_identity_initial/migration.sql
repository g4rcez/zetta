CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_audit" (
	"id" text PRIMARY KEY,
	"event_kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" text,
	"subject_user_id" text,
	"invitation_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"operator_reason" text,
	CONSTRAINT "identity_audit_event_kind_check" CHECK ("event_kind" in ('bootstrap', 'admin-replacement', 'invite-issued', 'invite-revoked', 'invite-consumed')),
	CONSTRAINT "identity_audit_actor_kind_check" CHECK ("actor_kind" in ('operator', 'user')),
	CONSTRAINT "identity_audit_actor_check" CHECK (
      ("actor_kind" = 'operator' and "actor_user_id" is null)
      or ("actor_kind" = 'user' and "actor_user_id" is not null)
    ),
	CONSTRAINT "identity_audit_replacement_reason_check" CHECK (
      "event_kind" <> 'admin-replacement'
      or ("actor_kind" = 'operator' and "operator_reason" is not null and length(btrim("operator_reason")) > 0)
    )
);
--> statement-breakpoint
CREATE TABLE "installation_identity" (
	"id" integer PRIMARY KEY,
	"admin_user_id" text NOT NULL,
	"admin_membership_status" text DEFAULT 'active' NOT NULL,
	"bootstrapped_at" timestamp with time zone NOT NULL,
	CONSTRAINT "installation_identity_singleton_check" CHECK ("id" = 1),
	CONSTRAINT "installation_identity_admin_active_check" CHECK ("admin_membership_status" = 'active')
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"token_hash" text NOT NULL CONSTRAINT "invitation_token_hash_unique" UNIQUE,
	"intended_email" text NOT NULL,
	"intended_user_id" text,
	"issued_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" text,
	CONSTRAINT "invitation_email_canonical_check" CHECK ("intended_email" = lower("intended_email")),
	CONSTRAINT "invitation_expiry_check" CHECK ("expires_at" > "created_at"),
	CONSTRAINT "invitation_consumption_check" CHECK (("consumed_at" is null) = ("consumed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"user_id" text PRIMARY KEY,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "membership_user_status_unique" UNIQUE("user_id","status"),
	CONSTRAINT "membership_status_check" CHECK ("status" in ('active', 'removed')),
	CONSTRAINT "membership_removal_check" CHECK (
      ("status" = 'active' and "removed_at" is null)
      or ("status" = 'removed' and "removed_at" is not null)
    )
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_subject_user_id_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_invitation_id_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "installation_identity" ADD CONSTRAINT "installation_identity_active_admin_fk" FOREIGN KEY ("admin_user_id","admin_membership_status") REFERENCES "membership"("user_id","status") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_intended_user_id_user_id_fkey" FOREIGN KEY ("intended_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_issued_by_user_id_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_consumed_by_user_id_user_id_fkey" FOREIGN KEY ("consumed_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
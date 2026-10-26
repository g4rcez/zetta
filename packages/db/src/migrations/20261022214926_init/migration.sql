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
	"activation_revision" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "membership_user_status_unique" UNIQUE("user_id","status"),
	CONSTRAINT "membership_activation_revision_check" CHECK ("activation_revision" between 1 and 2147483647),
	CONSTRAINT "membership_status_check" CHECK ("status" in ('active', 'removed')),
	CONSTRAINT "membership_removal_check" CHECK (
      ("status" = 'active' and "removed_at" is null)
      or ("status" = 'removed' and "removed_at" is not null)
    )
);
--> statement-breakpoint
CREATE TABLE "connection" (
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
CREATE TABLE "connection_credential" (
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
CREATE TABLE "connection_key_check" (
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
CREATE TABLE "connection_mutation_receipt" (
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
CREATE TABLE "connection_nonce" (
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
CREATE TABLE "run_attempts" (
	"id" uuid PRIMARY KEY,
	"run_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"generation" integer NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"status" text NOT NULL,
	"effect_state" text NOT NULL,
	"lease_id" uuid,
	"lease_expires_at" timestamp(3) with time zone,
	"claimed_at" timestamp(3) with time zone,
	"started_at" timestamp(3) with time zone,
	"finished_at" timestamp(3) with time zone,
	"stop_confirmed_at" timestamp(3) with time zone,
	"result_version" integer,
	"result_text" text,
	"result_error_code" text,
	"result_last_sequence" integer,
	"cancellation_reason" text,
	CONSTRAINT "run_attempts_run_generation_unique" UNIQUE("run_id","generation"),
	CONSTRAINT "run_attempts_id_run_owner_unique" UNIQUE("id","run_id","owner_user_id"),
	CONSTRAINT "run_attempts_generation_check" CHECK ("generation" between 1 and 2147483647),
	CONSTRAINT "run_attempts_status_check" CHECK ("status" in ('queued','running','succeeded','failed','cancelled','interrupted')),
	CONSTRAINT "run_attempts_effect_check" CHECK ("effect_state" in ('no_effect','known','uncertain')),
	CONSTRAINT "run_attempts_lease_check" CHECK (("lease_id" is null and "lease_expires_at" is null and "claimed_at" is null)
    or ("lease_id" is not null and "lease_expires_at" is not null and "claimed_at" is not null and "lease_expires_at" > "claimed_at")),
	CONSTRAINT "run_attempts_lifecycle_check" CHECK (
    ("status" = 'queued' and "effect_state" = 'no_effect' and "lease_id" is null and "started_at" is null
      and "finished_at" is null and "stop_confirmed_at" is null and "result_version" is null and "cancellation_reason" is null)
    or ("status" = 'running' and "effect_state" in ('no_effect','uncertain') and "lease_id" is not null
      and "finished_at" is null and "result_version" is null)
    or ("status" in ('succeeded','failed','cancelled','interrupted') and "finished_at" is not null)),
	CONSTRAINT "run_attempts_result_check" CHECK (("result_version" is null and "result_text" is null and "result_error_code" is null and "result_last_sequence" is null)
    or ("result_version" is not null and "result_version" = 1 and "result_text" is not null and octet_length("result_text") <= 65536
      and "result_last_sequence" is not null and "result_last_sequence" between 0 and 1000)),
	CONSTRAINT "run_attempts_error_check" CHECK ("result_error_code" is null or "result_error_code" in
    ('invalid_input','unsupported','malformed_output','out_of_order','output_limit','tool_denied','tool_failed','outcome_uncertain','deadline','adapter_failed')),
	CONSTRAINT "run_attempts_cancellation_check" CHECK ("cancellation_reason" is null or ("cancellation_reason" = 'owner_requested' and "status" in ('running','cancelled'))),
	CONSTRAINT "run_attempts_time_check" CHECK (("claimed_at" is null or "claimed_at" >= "created_at")
    and ("started_at" is null or ("claimed_at" is not null and "started_at" >= "claimed_at"))
    and ("finished_at" is null or ("finished_at" >= "created_at"
      and ("claimed_at" is null or "finished_at" >= "claimed_at")
      and ("started_at" is null or "finished_at" >= "started_at")))
    and ("stop_confirmed_at" is null or ("stop_confirmed_at" >= "created_at"
      and ("claimed_at" is null or "stop_confirmed_at" >= "claimed_at")
      and ("started_at" is null or "stop_confirmed_at" >= "started_at"))))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"origin_kind" text NOT NULL,
	"bot_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"configuration_id" text NOT NULL,
	"configuration_version" integer NOT NULL,
	"input_version" integer NOT NULL,
	"input_snapshot" text NOT NULL,
	"producer_kind" text,
	"producer_version" integer,
	"actor_activation_revision" integer,
	"created_at" timestamp(3) with time zone NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"current_generation" integer NOT NULL,
	"cancel_requested_at" timestamp(3) with time zone,
	"started_at" timestamp(3) with time zone,
	"finished_at" timestamp(3) with time zone,
	CONSTRAINT "runs_owner_request_unique" UNIQUE("owner_user_id","request_key"),
	CONSTRAINT "runs_id_owner_unique" UNIQUE("id","owner_user_id"),
	CONSTRAINT "runs_identifiers_check" CHECK ("owner_user_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'
    and "bot_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$' and "conversation_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'
    and "configuration_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'),
	CONSTRAINT "runs_origin_check" CHECK ("origin_kind" in ('interactive','setup')),
	CONSTRAINT "runs_counters_check" CHECK ("configuration_version" between 1 and 2147483647 and "revision" between 1 and 2147483647 and "current_generation" between 1 and 2147483647),
	CONSTRAINT "runs_input_check" CHECK ("input_version" = 1 and octet_length("input_snapshot") between 1 and 98304 and "input_snapshot" is json array),
	CONSTRAINT "runs_producer_check" CHECK (("producer_kind" is null and "producer_version" is null and "actor_activation_revision" is null)
    or ("producer_kind" is not null and "producer_version" is not null and "actor_activation_revision" is not null
      and "producer_kind" = 'fixture' and "producer_version" = 1 and "actor_activation_revision" between 1 and 2147483647)),
	CONSTRAINT "runs_status_check" CHECK ("status" in ('queued','running','succeeded','failed','cancelled','interrupted')),
	CONSTRAINT "runs_lifecycle_check" CHECK (
    ("status" = 'queued' and "started_at" is null and "finished_at" is null and "cancel_requested_at" is null)
    or ("status" = 'running' and "finished_at" is null)
    or ("status" in ('succeeded','failed','cancelled','interrupted') and "finished_at" is not null)),
	CONSTRAINT "runs_time_check" CHECK (("started_at" is null or "started_at" >= "created_at")
    and ("cancel_requested_at" is null or "cancel_requested_at" >= "created_at")
    and ("finished_at" is null or ("finished_at" >= "created_at"
      and ("started_at" is null or "finished_at" >= "started_at")
      and ("cancel_requested_at" is null or "finished_at" >= "cancel_requested_at"))))
);
--> statement-breakpoint
CREATE TABLE "dispatch_capacity" (
	"id" integer PRIMARY KEY,
	"launcher_installation_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"global_limit" integer NOT NULL,
	"actor_limit" integer NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "dispatch_capacity_installation_policy_unique" UNIQUE("launcher_installation_id","policy_version"),
	CONSTRAINT "dispatch_capacity_singleton_check" CHECK ("id" = 1),
	CONSTRAINT "dispatch_capacity_limits_check" CHECK ("global_limit" = 2 and "actor_limit" = 1),
	CONSTRAINT "dispatch_capacity_identifiers_check" CHECK ("launcher_installation_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$' and "policy_version" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'),
	CONSTRAINT "dispatch_capacity_time_check" CHECK (("created_at" is null or (isfinite("created_at") and extract(epoch from "created_at") * 1000 between -8640000000000000 and 8640000000000000)))
);
--> statement-breakpoint
CREATE TABLE "dispatch_claims" (
	"attempt_id" uuid PRIMARY KEY,
	"run_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"generation" integer NOT NULL,
	"lease_id" uuid NOT NULL,
	"claim_operation_id" uuid NOT NULL CONSTRAINT "dispatch_claims_operation_unique" UNIQUE,
	"launcher_installation_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"launch_spec_version" integer NOT NULL,
	"launch_spec_canonical" text NOT NULL,
	"launch_spec_digest" text NOT NULL,
	"launch_identity_digest" text NOT NULL,
	"image_digest" text NOT NULL,
	"deadline_at" timestamp(3) with time zone NOT NULL,
	"receipt_id" uuid,
	"prepare_intent_at" timestamp(3) with time zone,
	"resource_state" text NOT NULL,
	"pending_operation_id" uuid,
	"pending_operation_kind" text,
	"cleanup_kind" text,
	"cleanup_confirmed_at" timestamp(3) with time zone,
	"cancel_reason" text,
	"cancel_requested_at" timestamp(3) with time zone,
	"released_at" timestamp(3) with time zone,
	"revision" integer NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "dispatch_claims_attempt_run_owner_unique" UNIQUE("attempt_id","run_id","owner_user_id"),
	CONSTRAINT "dispatch_claims_installation_receipt_unique" UNIQUE("launcher_installation_id","receipt_id"),
	CONSTRAINT "dispatch_claims_identifiers_check" CHECK ("owner_user_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$' and "launcher_installation_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$' and "policy_version" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'),
	CONSTRAINT "dispatch_claims_counters_check" CHECK ("generation" between 1 and 2147483647 and "revision" between 1 and 2147483647),
	CONSTRAINT "dispatch_claims_payload_check" CHECK ("launch_spec_version" = 1 and octet_length("launch_spec_canonical") between 1 and 16384 and "launch_spec_canonical" is json array
    and "launch_spec_digest" collate "C" ~ '^[a-f0-9]{64}$' and "launch_identity_digest" collate "C" ~ '^[a-f0-9]{64}$' and "image_digest" collate "C" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "dispatch_claims_deadline_check" CHECK ("deadline_at" > "created_at" and "deadline_at" <= "created_at" + interval '60 seconds'),
	CONSTRAINT "dispatch_claims_state_check" CHECK ("resource_state" in ('not_submitted','prepare_pending','prepared','active','stopping','unknown','cleaned')
    and (("resource_state" = 'not_submitted' and "prepare_intent_at" is null and "receipt_id" is null and "pending_operation_id" is null)
      or ("resource_state" <> 'not_submitted' and "prepare_intent_at" is not null))
    and ("receipt_id" is null or "prepare_intent_at" is not null)
    and ("resource_state" not in ('prepared','active','stopping','cleaned') or "receipt_id" is not null)
    and ("resource_state" <> 'prepare_pending' or ("pending_operation_kind" is not null and "pending_operation_kind" = 'prepare' and "receipt_id" is null))),
	CONSTRAINT "dispatch_claims_pending_check" CHECK ((("pending_operation_id" is null and "pending_operation_kind" is null)
    or ("pending_operation_id" is not null and "pending_operation_kind" is not null and "pending_operation_kind" in ('prepare','activate','input','stop','remove')))
    and ("pending_operation_kind" is null or "pending_operation_kind" = 'prepare' or "receipt_id" is not null)),
	CONSTRAINT "dispatch_claims_cleanup_check" CHECK ((("cleanup_kind" is null and "cleanup_confirmed_at" is null)
    or ("cleanup_kind" is not null and "cleanup_confirmed_at" is not null and "pending_operation_id" is null
      and (("cleanup_kind" = 'not_submitted' and "resource_state" = 'not_submitted' and "prepare_intent_at" is null and "receipt_id" is null)
        or ("cleanup_kind" = 'removed' and "resource_state" = 'cleaned' and "receipt_id" is not null and "prepare_intent_at" is not null))))
    and ("resource_state" <> 'cleaned' or ("cleanup_kind" is not null and "cleanup_kind" = 'removed'))),
	CONSTRAINT "dispatch_claims_release_check" CHECK ("released_at" is null or ("cleanup_kind" is not null and "cleanup_confirmed_at" is not null
    and "pending_operation_id" is null and "released_at" >= "cleanup_confirmed_at")),
	CONSTRAINT "dispatch_claims_cancel_check" CHECK (("cancel_reason" is null and "cancel_requested_at" is null)
    or ("cancel_reason" is not null and "cancel_requested_at" is not null and "cancel_reason" in ('owner','deadline','revocation','shutdown','recovery')
      and ("cancel_reason" <> 'deadline' or "cancel_requested_at" >= "deadline_at"))),
	CONSTRAINT "dispatch_claims_time_check" CHECK (("created_at" is null or (isfinite("created_at") and extract(epoch from "created_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("updated_at" is null or (isfinite("updated_at") and extract(epoch from "updated_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("deadline_at" is null or (isfinite("deadline_at") and extract(epoch from "deadline_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("prepare_intent_at" is null or (isfinite("prepare_intent_at") and extract(epoch from "prepare_intent_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("cleanup_confirmed_at" is null or (isfinite("cleanup_confirmed_at") and extract(epoch from "cleanup_confirmed_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("cancel_requested_at" is null or (isfinite("cancel_requested_at") and extract(epoch from "cancel_requested_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("released_at" is null or (isfinite("released_at") and extract(epoch from "released_at") * 1000 between -8640000000000000 and 8640000000000000))
    and "updated_at" >= "created_at"
    and ("prepare_intent_at" is null or ("prepare_intent_at" >= "created_at" and "prepare_intent_at" <= "updated_at")) and ("cleanup_confirmed_at" is null or ("cleanup_confirmed_at" >= "created_at" and "cleanup_confirmed_at" <= "updated_at")) and ("cancel_requested_at" is null or ("cancel_requested_at" >= "created_at" and "cancel_requested_at" <= "updated_at")) and ("released_at" is null or ("released_at" >= "created_at" and "released_at" <= "updated_at")))
);
--> statement-breakpoint
CREATE TABLE "dispatch_grants" (
	"id" uuid PRIMARY KEY,
	"attempt_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"action_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sequence" integer NOT NULL,
	"canonical_action" text NOT NULL,
	"action_digest" text NOT NULL,
	"connection_id" uuid,
	"credential_version" integer,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"state" text NOT NULL,
	"delivery_outcome" text NOT NULL,
	"issued_at" timestamp(3) with time zone,
	"cancelled_at" timestamp(3) with time zone,
	"revision" integer NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "dispatch_grants_attempt_action_unique" UNIQUE("attempt_id","action_id"),
	CONSTRAINT "dispatch_grants_attempt_sequence_unique" UNIQUE("attempt_id","kind","sequence"),
	CONSTRAINT "dispatch_grants_owner_check" CHECK ("owner_user_id" collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'),
	CONSTRAINT "dispatch_grants_revision_check" CHECK ("revision" between 1 and 2147483647),
	CONSTRAINT "dispatch_grants_action_check" CHECK (("kind" = 'activate' and "sequence" = 1) or ("kind" = 'input' and "sequence" between 1 and 65537)),
	CONSTRAINT "dispatch_grants_payload_check" CHECK (octet_length("canonical_action") between 1 and 16384 and "canonical_action" is json array and "action_digest" collate "C" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "dispatch_grants_credentials_check" CHECK ("connection_id" is null and "credential_version" is null),
	CONSTRAINT "dispatch_grants_expiry_check" CHECK ("expires_at" > "created_at" and "expires_at" <= "created_at" + interval '30 seconds'),
	CONSTRAINT "dispatch_grants_state_check" CHECK (
    ("state" = 'pending' and "issued_at" is null and "cancelled_at" is null and "delivery_outcome" = 'not_attempted')
    or ("state" = 'issued' and "issued_at" is not null and "delivery_outcome" in ('not_attempted','acknowledged'))
    or ("state" = 'uncertain' and "delivery_outcome" in ('unknown','acknowledged'))
    or ("state" = 'cancelled' and "cancelled_at" is not null and "issued_at" is null and "delivery_outcome" = 'not_attempted')
    or ("state" = 'expired' and "issued_at" is null and "cancelled_at" is null and "delivery_outcome" = 'not_attempted' and "updated_at" >= "expires_at")),
	CONSTRAINT "dispatch_grants_time_check" CHECK (("created_at" is null or (isfinite("created_at") and extract(epoch from "created_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("updated_at" is null or (isfinite("updated_at") and extract(epoch from "updated_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("expires_at" is null or (isfinite("expires_at") and extract(epoch from "expires_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("issued_at" is null or (isfinite("issued_at") and extract(epoch from "issued_at") * 1000 between -8640000000000000 and 8640000000000000)) and ("cancelled_at" is null or (isfinite("cancelled_at") and extract(epoch from "cancelled_at") * 1000 between -8640000000000000 and 8640000000000000))
    and "updated_at" >= "created_at" and ("issued_at" is null or ("issued_at" >= "created_at" and "issued_at" <= "updated_at")) and ("cancelled_at" is null or ("cancelled_at" >= "created_at" and "cancelled_at" <= "updated_at"))
    and ("issued_at" is null or ("issued_at" < "expires_at" and ("cancelled_at" is null or "cancelled_at" >= "issued_at"))))
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "connection_owner_id_idx" ON "connection" ("owner_user_id","id");--> statement-breakpoint
CREATE INDEX "runs_owner_id_idx" ON "runs" ("owner_user_id","id");--> statement-breakpoint
CREATE INDEX "dispatch_claims_occupied_owner_idx" ON "dispatch_claims" ("launcher_installation_id","owner_user_id") WHERE "released_at" is null;--> statement-breakpoint
CREATE INDEX "dispatch_claims_occupied_attempt_idx" ON "dispatch_claims" ("launcher_installation_id","attempt_id") WHERE "released_at" is null;--> statement-breakpoint
CREATE INDEX "dispatch_grants_attempt_id_idx" ON "dispatch_grants" ("attempt_id","id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_subject_user_id_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_invitation_id_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "installation_identity" ADD CONSTRAINT "installation_identity_active_admin_fk" FOREIGN KEY ("admin_user_id","admin_membership_status") REFERENCES "membership"("user_id","status") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_intended_user_id_user_id_fkey" FOREIGN KEY ("intended_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_issued_by_user_id_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_consumed_by_user_id_user_id_fkey" FOREIGN KEY ("consumed_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "connection_credential" ADD CONSTRAINT "connection_credential_owner_fk" FOREIGN KEY ("connection_id","owner_user_id","kind") REFERENCES "connection"("id","owner_user_id","kind") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "connection_credential" ADD CONSTRAINT "connection_credential_nonce_fk" FOREIGN KEY ("key_id","nonce","connection_id","credential_version") REFERENCES "connection_nonce"("key_id","nonce","connection_id","credential_version") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "connection_key_check" ADD CONSTRAINT "connection_key_check_nonce_fk" FOREIGN KEY ("key_id","nonce","nonce_purpose") REFERENCES "connection_nonce"("key_id","nonce","purpose") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "connection_mutation_receipt" ADD CONSTRAINT "connection_receipt_owner_fk" FOREIGN KEY ("connection_id","owner_user_id","kind") REFERENCES "connection"("id","owner_user_id","kind") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_owner_fk" FOREIGN KEY ("run_id","owner_user_id") REFERENCES "runs"("id","owner_user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_user_id_membership_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "membership"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "dispatch_claims" ADD CONSTRAINT "dispatch_claims_attempt_fk" FOREIGN KEY ("attempt_id","run_id","owner_user_id") REFERENCES "run_attempts"("id","run_id","owner_user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "dispatch_claims" ADD CONSTRAINT "dispatch_claims_policy_fk" FOREIGN KEY ("launcher_installation_id","policy_version") REFERENCES "dispatch_capacity"("launcher_installation_id","policy_version") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "dispatch_grants" ADD CONSTRAINT "dispatch_grants_claim_fk" FOREIGN KEY ("attempt_id","run_id","owner_user_id") REFERENCES "dispatch_claims"("attempt_id","run_id","owner_user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
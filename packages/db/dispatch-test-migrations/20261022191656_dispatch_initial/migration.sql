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
CREATE INDEX "dispatch_claims_occupied_owner_idx" ON "dispatch_claims" ("launcher_installation_id","owner_user_id") WHERE "released_at" is null;--> statement-breakpoint
CREATE INDEX "dispatch_claims_occupied_attempt_idx" ON "dispatch_claims" ("launcher_installation_id","attempt_id") WHERE "released_at" is null;--> statement-breakpoint
CREATE INDEX "dispatch_grants_attempt_id_idx" ON "dispatch_grants" ("attempt_id","id");--> statement-breakpoint
ALTER TABLE "dispatch_claims" ADD CONSTRAINT "dispatch_claims_attempt_fk" FOREIGN KEY ("attempt_id","run_id","owner_user_id") REFERENCES "run_attempts"("id","run_id","owner_user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "dispatch_claims" ADD CONSTRAINT "dispatch_claims_policy_fk" FOREIGN KEY ("launcher_installation_id","policy_version") REFERENCES "dispatch_capacity"("launcher_installation_id","policy_version") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "dispatch_grants" ADD CONSTRAINT "dispatch_grants_claim_fk" FOREIGN KEY ("attempt_id","run_id","owner_user_id") REFERENCES "dispatch_claims"("attempt_id","run_id","owner_user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
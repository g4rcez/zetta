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
CREATE INDEX "runs_owner_id_idx" ON "runs" ("owner_user_id","id");--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_owner_fk" FOREIGN KEY ("run_id","owner_user_id") REFERENCES "runs"("id","owner_user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_user_id_membership_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "membership"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
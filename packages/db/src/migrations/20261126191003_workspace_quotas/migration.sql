CREATE TABLE "zetta"."usage_counter" (
	"workspace_id" uuid,
	"period" text,
	"metric" text,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counter_pkey" PRIMARY KEY("workspace_id","period","metric"),
	CONSTRAINT "usage_counter_metric_check" CHECK ("metric" in ('runs', 'run_seconds')),
	CONSTRAINT "usage_counter_period_check" CHECK ("period" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "zetta"."workspace_quota" (
	"workspace_id" uuid PRIMARY KEY,
	"runs_per_month" integer,
	"run_seconds_per_month" integer,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_quota_limits_check" CHECK (coalesce("runs_per_month", 0) >= 0 and coalesce("run_seconds_per_month", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "zetta"."usage_counter" ADD CONSTRAINT "usage_counter_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."workspace_quota" ADD CONSTRAINT "workspace_quota_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
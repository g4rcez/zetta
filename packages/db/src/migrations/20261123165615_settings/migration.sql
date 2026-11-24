CREATE TABLE "zetta"."setting" (
	"scope_kind" text NOT NULL,
	"scope_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_scope_key_unique" UNIQUE NULLS NOT DISTINCT("scope_kind","scope_id","key"),
	CONSTRAINT "setting_scope_kind_check" CHECK ("scope_kind" in ('installation', 'workspace')),
	CONSTRAINT "setting_scope_id_check" CHECK (("scope_kind" = 'installation') = ("scope_id" is null)),
	CONSTRAINT "setting_key_check" CHECK (length("key") between 1 and 64)
);

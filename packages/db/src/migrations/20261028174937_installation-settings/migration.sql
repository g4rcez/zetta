CREATE TABLE "installation_settings" (
	"id" integer PRIMARY KEY,
	"network_mode" text DEFAULT 'local' NOT NULL,
	"public_url" text,
	"onboarding" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_settings_singleton_check" CHECK ("id" = 1),
	CONSTRAINT "installation_settings_network_url_check" CHECK ("network_mode" = 'local' or "public_url" is not null)
);

ALTER TABLE "zetta"."browser_profile" ADD COLUMN "kind" text DEFAULT 'isolated' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."browser_profile" ADD COLUMN "cdp_port" integer;
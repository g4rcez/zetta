ALTER TABLE "zetta"."audit_event" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "zetta"."audit_event" ADD COLUMN "output_tokens" integer;
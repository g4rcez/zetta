ALTER TABLE "runs" ADD COLUMN "producer_kind" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "producer_version" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "actor_activation_revision" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_producer_check" CHECK (("producer_kind" is null and "producer_version" is null and "actor_activation_revision" is null)
    or ("producer_kind" is not null and "producer_version" is not null and "actor_activation_revision" is not null
      and "producer_kind" = 'fixture' and "producer_version" = 1 and "actor_activation_revision" between 1 and 2147483647));
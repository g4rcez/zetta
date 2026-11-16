CREATE TABLE "zetta"."work_watch" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quiet_until" timestamp with time zone,
	"fingerprint" text DEFAULT '' NOT NULL,
	"checked_at" timestamp with time zone,
	"verdict" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zetta"."attention_item" ADD COLUMN "work" jsonb;--> statement-breakpoint
CREATE INDEX "attention_item_subject_idx" ON "zetta"."attention_item" ("owner_user_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_watch_task_kind_unique" ON "zetta"."work_watch" ("task_id","kind");--> statement-breakpoint
ALTER TABLE "zetta"."work_watch" ADD CONSTRAINT "work_watch_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "zetta"."task"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
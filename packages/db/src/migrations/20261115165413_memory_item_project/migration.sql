CREATE TABLE "zetta"."memory_item_project" (
	"page_id" uuid,
	"project_id" uuid,
	CONSTRAINT "memory_item_project_pkey" PRIMARY KEY("page_id","project_id")
);
--> statement-breakpoint
CREATE INDEX "memory_item_project_project_idx" ON "zetta"."memory_item_project" ("project_id");--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_project" ADD CONSTRAINT "memory_item_project_page_id_memory_item_id_fkey" FOREIGN KEY ("page_id") REFERENCES "zetta"."memory_item"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."memory_item_project" ADD CONSTRAINT "memory_item_project_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zetta"."project"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
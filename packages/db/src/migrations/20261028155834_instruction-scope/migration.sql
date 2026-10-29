ALTER TABLE "instruction" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "instruction" ADD COLUMN "created_by_bot_id" uuid;--> statement-breakpoint
CREATE INDEX "instruction_team_id_idx" ON "instruction" ("team_id");--> statement-breakpoint
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_created_by_bot_id_bot_id_fkey" FOREIGN KEY ("created_by_bot_id") REFERENCES "bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
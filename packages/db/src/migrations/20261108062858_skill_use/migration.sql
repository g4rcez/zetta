CREATE TABLE "zetta"."skill_use" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"skill_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"source" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "skill_use_skill_idx" ON "zetta"."skill_use" ("skill_id","used_at");--> statement-breakpoint
CREATE INDEX "skill_use_bot_idx" ON "zetta"."skill_use" ("bot_id");--> statement-breakpoint
ALTER TABLE "zetta"."skill_use" ADD CONSTRAINT "skill_use_skill_id_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "zetta"."skill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."skill_use" ADD CONSTRAINT "skill_use_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
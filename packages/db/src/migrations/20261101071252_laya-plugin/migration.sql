ALTER TABLE "installation_settings" ADD COLUMN "laya" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
-- Laya was on for everyone before this setting. Keep it on only where it is in use (bot decision routing or a workflow Decide node); a missing row means the defaults.
INSERT INTO "installation_settings" ("id", "laya")
SELECT 1, 'on'
WHERE EXISTS (SELECT 1 FROM "decision_config" WHERE "enabled" AND "backend" = 'laya')
   OR EXISTS (SELECT 1 FROM "workflow" WHERE jsonb_path_exists("graph", '$.nodes.* ? (@.type == "decision")'))
ON CONFLICT ("id") DO UPDATE SET "laya" = 'on';

-- Every bot owns its own Claude Code / Hermes settings row. Existing bots get the defaults ("auto" = what they already did); new bots get one when created.
INSERT INTO "bot_claude_config" ("bot_id") SELECT "id" FROM "bot" ON CONFLICT ("bot_id") DO NOTHING;

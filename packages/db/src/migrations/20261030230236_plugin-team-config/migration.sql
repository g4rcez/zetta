-- A team configuration now exposes every tool and only the administrator edits it. Plugins that a member lent to the team before
-- (reduced tool set) go back to private: nothing is deleted except the teammates' bindings of them.
DELETE FROM "bot_integration" bi USING "mcp_server" s
WHERE bi."server_id" = s."id" AND s."sharing" = 'team' AND bi."owner_user_id" <> s."owner_user_id"
  AND s."owner_user_id" NOT IN (SELECT "admin_user_id" FROM "installation_identity");--> statement-breakpoint
UPDATE "mcp_server" SET "sharing" = 'private'
WHERE "sharing" = 'team' AND "owner_user_id" NOT IN (SELECT "admin_user_id" FROM "installation_identity");--> statement-breakpoint
ALTER TABLE "mcp_server" DROP CONSTRAINT "mcp_server_owner_name";--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_owner_name" UNIQUE("owner_user_id","name","sharing");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_team_name" ON "mcp_server" ("name") WHERE "sharing" = 'team';
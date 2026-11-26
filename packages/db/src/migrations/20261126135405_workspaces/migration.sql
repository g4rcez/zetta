CREATE TABLE "zetta"."chief_share" (
	"user_id" text PRIMARY KEY,
	"bot_id" uuid NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zetta"."invitation_grant" (
	"invitation_id" text PRIMARY KEY,
	"workspace_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"chief_bot_id" uuid,
	CONSTRAINT "invitation_grant_role_check" CHECK ("role" in ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "zetta"."workspace" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"slug" text NOT NULL CONSTRAINT "workspace_slug_unique" UNIQUE,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_slug_check" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "workspace_name_check" CHECK (length("name") between 1 and 80),
	CONSTRAINT "workspace_status_check" CHECK ("status" in ('active', 'suspended', 'deleting', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "zetta"."workspace_member" (
	"workspace_id" uuid,
	"user_id" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_pkey" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_member_role_check" CHECK ("role" in ('owner', 'admin', 'member')),
	CONSTRAINT "workspace_member_status_check" CHECK ("status" in ('active', 'removed')),
	CONSTRAINT "workspace_member_removal_check" CHECK (("status" = 'active' and "removed_at" is null) or ("status" = 'removed' and "removed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "chief_share_bot_id_idx" ON "zetta"."chief_share" ("bot_id");--> statement-breakpoint
CREATE INDEX "chief_share_granted_by_user_id_idx" ON "zetta"."chief_share" ("granted_by_user_id");--> statement-breakpoint
CREATE INDEX "invitation_grant_workspace_id_idx" ON "zetta"."invitation_grant" ("workspace_id");--> statement-breakpoint
CREATE INDEX "invitation_grant_chief_bot_id_idx" ON "zetta"."invitation_grant" ("chief_bot_id");--> statement-breakpoint
CREATE INDEX "workspace_member_user_id_idx" ON "zetta"."workspace_member" ("user_id");--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ADD CONSTRAINT "chief_share_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ADD CONSTRAINT "chief_share_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."chief_share" ADD CONSTRAINT "chief_share_granted_by_user_id_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."invitation_grant" ADD CONSTRAINT "invitation_grant_invitation_id_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "zetta"."invitation"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."invitation_grant" ADD CONSTRAINT "invitation_grant_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."invitation_grant" ADD CONSTRAINT "invitation_grant_chief_bot_id_bot_id_fkey" FOREIGN KEY ("chief_bot_id") REFERENCES "zetta"."bot"("id") ON DELETE SET NULL ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "zetta"."workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "zetta"."user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
-- A server that already has people becomes one workspace that holds them all. The person who set it up owns it; everyone else is a member.
INSERT INTO "zetta"."workspace" ("slug", "name")
SELECT 'main', 'Workspace' WHERE EXISTS (SELECT 1 FROM "zetta"."installation_identity" WHERE "id" = 1);
--> statement-breakpoint
INSERT INTO "zetta"."workspace_member" ("workspace_id", "user_id", "role", "status", "joined_at", "removed_at", "updated_at")
SELECT w."id", m."user_id", CASE WHEN i."admin_user_id" = m."user_id" THEN 'owner' ELSE 'member' END, m."status", m."joined_at", m."removed_at", m."updated_at"
FROM "zetta"."membership" m
JOIN "zetta"."workspace" w ON w."slug" = 'main'
JOIN "zetta"."installation_identity" i ON i."id" = 1;
--> statement-breakpoint
-- Invitations that can still be used join that workspace as members, as they did before.
INSERT INTO "zetta"."invitation_grant" ("invitation_id", "workspace_id", "role")
SELECT inv."id", w."id", 'member'
FROM "zetta"."invitation" inv
JOIN "zetta"."workspace" w ON w."slug" = 'main'
WHERE inv."consumed_at" IS NULL AND inv."revoked_at" IS NULL;

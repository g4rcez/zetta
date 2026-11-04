ALTER TABLE "zetta"."workspace" RENAME TO "folder";--> statement-breakpoint
ALTER TABLE "zetta"."bot" RENAME COLUMN "workspace_id" TO "folder_id";--> statement-breakpoint
ALTER TABLE "zetta"."folder" RENAME CONSTRAINT "workspace_name_check" TO "folder_name_check";--> statement-breakpoint
ALTER INDEX "zetta"."bot_workspace_id_idx" RENAME TO "bot_folder_id_idx";--> statement-breakpoint
ALTER INDEX "zetta"."workspace_parent_id_idx" RENAME TO "folder_parent_id_idx";--> statement-breakpoint
ALTER TABLE "zetta"."folder" RENAME CONSTRAINT "workspace_owner_name_unique" TO "folder_owner_name_unique";--> statement-breakpoint
ALTER TABLE "zetta"."folder" RENAME CONSTRAINT "workspace_pkey" TO "folder_pkey";--> statement-breakpoint
ALTER TABLE "zetta"."folder" RENAME CONSTRAINT "workspace_owner_user_id_user_id_fkey" TO "folder_owner_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."folder" RENAME CONSTRAINT "workspace_parent_id_workspace_id_fkey" TO "folder_parent_id_folder_id_fkey";--> statement-breakpoint
ALTER TABLE "zetta"."bot" RENAME CONSTRAINT "bot_workspace_id_workspace_id_fkey" TO "bot_folder_id_folder_id_fkey";

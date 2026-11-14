ALTER TABLE "zetta"."attention_item" ADD COLUMN "kind" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "zetta"."attention_item" ADD COLUMN "subject_id" text;--> statement-breakpoint
ALTER TABLE "zetta"."config_proposal" ADD COLUMN "result_link" text;--> statement-breakpoint
-- Old cards get the kind the producers now stamp. The key prefix is the only place the kind was recorded, so read it from there; the two
-- cards that never had a key are told apart by their title. Nothing is deleted and no status changes.
UPDATE "zetta"."attention_item" SET "kind" = CASE
  WHEN "source_key" LIKE 'proposal:%' THEN 'proposal'
  WHEN "source_key" LIKE 'task-follow:%' THEN 'task_follow'
  WHEN "source_key" LIKE 'task:%' THEN 'task_ask'
  WHEN "source_key" LIKE 'handoff:%' THEN 'bot_ask'
  WHEN "source_key" LIKE 'loop:%' THEN 'loop_paused'
  WHEN "source_key" LIKE 'discussion:%:stuck:%' THEN 'room_stuck'
  WHEN "source_key" LIKE 'discussion:%:failed:%' THEN 'room_failed'
  WHEN "source_key" LIKE 'discussion:%:interrupted' THEN 'room_interrupted'
  WHEN "source_key" LIKE 'discussion:%:idle' THEN 'room_idle'
  WHEN "source_key" LIKE 'discussion:%:secret' THEN 'room_withheld'
  WHEN "source_key" LIKE 'permission:%' THEN 'permission_request'
  WHEN "source_key" LIKE 'routine:%:failed' THEN 'routine_failed'
  WHEN "source_key" LIKE 'routine:%:blocked' THEN 'routine_blocked'
  WHEN "source_key" LIKE 'routine:%:interrupted' THEN 'routine_interrupted'
  WHEN "source_key" LIKE 'trigger:%:failing' THEN 'trigger_failing'
  WHEN "source_key" LIKE 'workflow:%:failed' THEN 'workflow_failed'
  WHEN "source_key" LIKE 'workflow:%:interrupted' THEN 'workflow_interrupted'
  WHEN "source_key" LIKE 'login:%' THEN 'sign_in'
  WHEN "source_key" IN ('knowledge-sync:auth', 'agenda-sync:auth') THEN 'connection_lost'
  WHEN "source_key" LIKE 'inbound:%:poll' THEN 'connection_lost'
  WHEN "source_key" LIKE 'inbound:%:disabled' THEN 'inbound_stopped'
  WHEN "source_key" LIKE 'inbound:%:rate' THEN 'inbound_rate'
  WHEN "source_key" LIKE 'inbound:%:failed' THEN 'inbound_unanswered'
  WHEN "source_key" LIKE 'memory-suggestion:%' THEN 'memory_suggestion'
  WHEN "source_key" LIKE 'memory-stale:%' THEN 'memory_stale'
  WHEN "source_key" LIKE 'hook-invalid:%' THEN 'hook_invalid'
  WHEN "source_key" LIKE 'bg-failed:%' THEN 'background_failed'
  WHEN "source_key" LIKE 'slow-turn:%' THEN 'turn_slow'
  WHEN "source_key" LIKE 'agenda:%' THEN 'agenda_reminder'
  WHEN "source_key" IS NULL AND "title" LIKE 'Background task from %' THEN 'background_done'
  WHEN "source_key" IS NULL AND "title" LIKE '% updated your memory after finished work' THEN 'memory_updated'
  WHEN "source" = 'manual' THEN 'manual'
  ELSE 'other'
END;--> statement-breakpoint
-- The id the card is about is the second part of its key. Only a value shaped like an id is kept: `agenda-sync:auth` names no subject.
UPDATE "zetta"."attention_item"
SET "subject_id" = split_part("source_key", ':', 2)
WHERE "source_key" IS NOT NULL
  AND split_part("source_key", ':', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';--> statement-breakpoint
-- An approval used to keep its "Open in chat" link only on its card; the proposal now carries it, so Catch up needs no second record.
UPDATE "zetta"."config_proposal" p
SET "result_link" = a."result_link"
FROM "zetta"."attention_item" a
WHERE a."source_key" = 'proposal:' || p."id"::text
  AND a."owner_user_id" = p."owner_user_id"
  AND a."result_link" IS NOT NULL
  AND p."result_link" IS NULL;

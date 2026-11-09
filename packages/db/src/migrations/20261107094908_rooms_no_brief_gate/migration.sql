-- Rooms no longer hold their bots for a brief approval, except rooms that came from an outside channel (origin_inbound set).
-- Data only: waiting turns run, the cards that asked about them close, and nothing is deleted.
UPDATE "zetta"."discussion_member" m
SET "require_approval" = false
FROM "zetta"."discussion" d
WHERE d."id" = m."discussion_id" AND d."origin_inbound" IS NULL AND m."require_approval";--> statement-breakpoint
UPDATE "zetta"."discussion_turn" t
SET "status" = 'queued'
FROM "zetta"."discussion" d
WHERE d."id" = t."discussion_id" AND d."origin_inbound" IS NULL AND t."status" = 'awaiting_approval';--> statement-breakpoint
UPDATE "zetta"."attention_item" a
SET "status" = 'cancelled', "updated_at" = now()
FROM "zetta"."config_proposal" p
JOIN "zetta"."discussion" d ON d."id"::text = p."patch"->>'discussionId'
WHERE p."kind" = 'discussion_brief' AND p."status" = 'pending' AND d."origin_inbound" IS NULL
  AND a."source_key" = 'proposal:' || p."id"::text AND a."status" IN ('open', 'acknowledged');--> statement-breakpoint
UPDATE "zetta"."config_proposal" p
SET "status" = 'stale', "decided_at" = now()
FROM "zetta"."discussion" d
WHERE d."id"::text = p."patch"->>'discussionId'
  AND p."kind" = 'discussion_brief' AND p."status" = 'pending' AND d."origin_inbound" IS NULL;

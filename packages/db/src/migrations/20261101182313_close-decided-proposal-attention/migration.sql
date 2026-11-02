-- Cards of decided proposals stayed open because the decision never closed them. Status only; no row is deleted.
UPDATE "attention_item" a
SET "status" = CASE WHEN p."status" = 'rejected' THEN 'cancelled' ELSE 'resolved' END, "updated_at" = now()
FROM "config_proposal" p
WHERE a."source_key" = 'proposal:' || p."id"
  AND a."status" IN ('open', 'acknowledged')
  AND p."status" <> 'pending';

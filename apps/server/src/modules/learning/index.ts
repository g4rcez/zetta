import type { Database } from "@zetta/db";
import { createBackfill } from "./backfill";
import { createOutcomes } from "./outcomes";
import { createUses } from "./uses";

/**
 * Bots that learn, check and forget (docs/decisions/lessons.md). This module records what each reply had in front of it (`uses`) and
 * whether the person had to step in afterwards (`outcomes`); `backfill` builds that record for past replies once.
 */
export function createLearning(db: Database) {
  const uses = createUses(db);
  return { uses, outcomes: createOutcomes(db), backfill: createBackfill(db, uses) };
}
export type Learning = ReturnType<typeof createLearning>;

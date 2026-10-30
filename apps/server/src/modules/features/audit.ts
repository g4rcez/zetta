import type { Database } from "@zetta/db";
import { and, desc, eq, lt } from "@zetta/db/query";
import { auditEvent } from "@zetta/db/schema/features";

export type AuditKind = (typeof auditEvent.$inferInsert)["kind"];
export type AuditOutcome = (typeof auditEvent.$inferInsert)["outcome"];
/** `detail` is a short closed token (e.g. a tool kind or an action name), never user text, URLs, prompts or provider errors. */
const SAFE_DETAIL = /^[a-z0-9_:.-]{1,40}$/;

/** `prefix:tool` when the tool name fits the closed token shape, else just the prefix (tool names come from third-party servers). */
export const auditToolDetail = (prefix: string, tool: string) => {
  const d = `${prefix}:${tool.toLowerCase()}`;
  return SAFE_DETAIL.test(d) ? d : prefix;
};

/** Best-effort audit write: never throws and never blocks the caller's work. */
export async function audit(
  db: Pick<Database, "insert">,
  ownerUserId: string,
  e: {
    kind: AuditKind;
    outcome: AuditOutcome;
    botId?: string | null;
    subjectId?: string | null;
    detail?: string;
  },
) {
  try {
    await db.insert(auditEvent).values({
      ownerUserId,
      kind: e.kind,
      outcome: e.outcome,
      botId: e.botId ?? null,
      subjectId: e.subjectId ?? null,
      detail: e.detail && SAFE_DETAIL.test(e.detail) ? e.detail : null,
    });
  } catch {
    /* auditing must not break the product */
  }
}

/** Owner-scoped activity listing with keyset pagination on time. */
export async function listActivity(
  db: Pick<Database, "select">,
  ownerUserId: string,
  opts: { before?: string; limit?: number; kind?: AuditKind } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 100);
  const rows = await db
    .select()
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.ownerUserId, ownerUserId),
        opts.kind ? eq(auditEvent.kind, opts.kind) : undefined,
        opts.before ? lt(auditEvent.createdAt, new Date(opts.before)) : undefined,
      ),
    )
    .orderBy(desc(auditEvent.createdAt))
    .limit(limit + 1);
  return {
    events: rows.slice(0, limit).map(({ ownerUserId: _o, ...e }) => e),
    nextBefore: rows.length > limit ? rows[limit - 1]!.createdAt.toISOString() : null,
  };
}

export function outcomeOf(code: string | undefined): AuditOutcome {
  switch (code) {
    case undefined:
      return "ok";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    case "busy":
      return "busy";
    case "auth_required":
      return "auth_required";
    case "not_installed":
      return "not_installed";
    default:
      return "failed";
  }
}

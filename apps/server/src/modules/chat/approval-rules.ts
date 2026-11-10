import type { Database } from "@zetta/db";
import { and, desc, eq, isNull, or } from "@zetta/db/query";
import { approvalRule } from "@zetta/db/schema/features";

/**
 * "Always allow for this bot" on an approval card. The person answers a kind of card once, and the same kind of change by the same bot
 * applies from then on without asking (each one still shows as a receipt). A rule is per person and bot, listed and revoked on the bot
 * page.
 *
 * Some cards are never remembered: a permission grant (rm, sudo, mail), skills from outside, host code, a new computer, a plugin's
 * question and a room brief from outside people. Each of those is a decision about one specific thing, not a kind of change.
 */
export const NEVER_REMEMBERED = new Set([
  "bot_permission",
  "install_skills",
  "publish_app",
  "create_vm",
  "tool_resume",
  "discussion_brief",
]);

/** What narrows a broad kind: the tool of a chief action, the call kinds of a held bot action. Empty for the other kinds. */
export function actionKeyOf(kind: string, patch: unknown): string {
  const p = (patch ?? {}) as { tool?: unknown; calls?: unknown };
  if (kind === "chief_action" && typeof p.tool === "string") return p.tool;
  if (kind === "bot_action" && Array.isArray(p.calls))
    return [
      ...new Set(
        p.calls
          .map((c) => (c && typeof c === "object" ? (c as { kind?: unknown }).kind : undefined))
          .filter((k): k is string => typeof k === "string"),
      ),
    ]
      .sort()
      .join(",");
  return "";
}

export function canRemember(kind: string, patch: unknown): boolean {
  if (NEVER_REMEMBERED.has(kind)) return false;
  // A chief action with no named tool, or a held bot action with no calls, cannot be narrowed: it would allow too much.
  if ((kind === "chief_action" || kind === "bot_action") && !actionKeyOf(kind, patch)) return false;
  return true;
}

const LABELS: Record<string, string> = {
  config: "Change its own settings",
  create_bot: "Create bots",
  create_routine: "Create routines",
  create_workflow: "Create workflows",
  open_discussion: "Open rooms with other bots",
  start_loop: "Start goal loops",
  team_goals: "Give team members goals",
  create_memory_item: "Save to memory",
  chief_action: "Setup action",
  bot_action: "Run",
};
export const ruleLabel = (kind: string, actionKey: string) =>
  [LABELS[kind] ?? kind, actionKey].filter(Boolean).join(": ");

export function createApprovalRules(db: Database) {
  return {
    /** The active rule that covers this card, if any. */
    async match(
      ownerUserId: string,
      botId: string | null,
      kind: string,
      patch: unknown,
      /** The chat the card comes from: a rule for that chat, or for every chat of the bot, covers it. */
      conversationId?: string,
    ) {
      if (!botId || !canRemember(kind, patch)) return undefined;
      const [row] = await db
        .select()
        .from(approvalRule)
        .where(
          and(
            eq(approvalRule.ownerUserId, ownerUserId),
            eq(approvalRule.botId, botId),
            eq(approvalRule.kind, kind),
            eq(approvalRule.actionKey, actionKeyOf(kind, patch)),
            eq(approvalRule.status, "active"),
            conversationId
              ? or(
                  isNull(approvalRule.conversationId),
                  eq(approvalRule.conversationId, conversationId),
                )
              : isNull(approvalRule.conversationId),
          ),
        )
        .limit(1);
      return row;
    },
    /** Saves "Always allow" from the card the person just approved. Repeating it for the same kind keeps one rule. */
    async remember(
      ownerUserId: string,
      p: { id: string; botId: string | null; kind: string; patch: unknown },
      /** "Allow for this chat": only this conversation. Absent: every chat of the bot. */
      conversationId?: string,
    ) {
      if (!p.botId || !canRemember(p.kind, p.patch)) return undefined;
      const existing = await this.match(ownerUserId, p.botId, p.kind, p.patch, conversationId);
      if (existing && (existing.conversationId ?? undefined) === conversationId) return existing;
      if (existing && !existing.conversationId) return existing; // already allowed in every chat
      const actionKey = actionKeyOf(p.kind, p.patch);
      const [row] = await db
        .insert(approvalRule)
        .values({
          ownerUserId,
          botId: p.botId,
          kind: p.kind,
          actionKey,
          label: ruleLabel(p.kind, actionKey),
          sourceProposalId: p.id,
          conversationId: conversationId ?? null,
        })
        .returning();
      return row;
    },
    list(ownerUserId: string, botId: string) {
      return db
        .select({
          id: approvalRule.id,
          kind: approvalRule.kind,
          actionKey: approvalRule.actionKey,
          label: approvalRule.label,
          conversationId: approvalRule.conversationId,
          createdAt: approvalRule.createdAt,
        })
        .from(approvalRule)
        .where(
          and(
            eq(approvalRule.ownerUserId, ownerUserId),
            eq(approvalRule.botId, botId),
            eq(approvalRule.status, "active"),
          ),
        )
        .orderBy(desc(approvalRule.createdAt));
    },
    async revoke(ownerUserId: string, id: string) {
      const [row] = await db
        .update(approvalRule)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(approvalRule.id, id),
            eq(approvalRule.ownerUserId, ownerUserId),
            eq(approvalRule.status, "active"),
          ),
        )
        .returning({ id: approvalRule.id });
      return row;
    },
  };
}
export type ApprovalRules = ReturnType<typeof createApprovalRules>;

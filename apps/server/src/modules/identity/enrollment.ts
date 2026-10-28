import { createHash, randomBytes } from "node:crypto";
import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { identityAudit, installationIdentity, invitation, membership } from "@zetta/db/schema/identity";
import { and, eq, gt, isNull, or, sql } from "@zetta/db/query";

/** Supplied only by trusted server authentication, never deserialized from a request body.
 * Email and authority are deliberately absent: both are re-read under transaction locks.
 */
export type EnrollmentActor = Readonly<{ userId: string }>;

export class EnrollmentUnavailableError extends Error {
  constructor() {
    super("Enrollment is unavailable. Sign in with the intended account or ask the administrator for a new invitation.");
    this.name = "EnrollmentUnavailableError";
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type AuditEvent = "invite-issued" | "invite-revoked" | "invite-consumed";

function unavailable(): never {
  throw new EnrollmentUnavailableError();
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function body(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return unavailable();
  const fields = Object.keys(value);
  if (fields.some((key) => !required.includes(key) && !optional.includes(key)) || required.some((key) => !fields.includes(key))) {
    return unavailable();
  }
  return value as Record<string, unknown>;
}

function actorId(actor: EnrollmentActor): string {
  const value = body(actor, ["userId"]);
  if (!nonempty(value.userId)) return unavailable();
  return value.userId;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function audit(tx: Transaction, eventKind: AuditEvent, actorUserId: string, invitationId: string, subjectUserId: string | null) {
  await tx.insert(identityAudit).values({
    id: uuidv7(), eventKind, actorKind: "user", actorUserId, subjectUserId, invitationId,
    occurredAt: sql`clock_timestamp()`,
  });
}

/** Lock all account/FK targets before sorted memberships; never upgrade after membership. */
async function lockIdentity(tx: Transaction, userId: string, scope: Readonly<{ adminOnly: boolean; intendedUserId?: string | null }>) {
  const [installation] = await tx.select({ adminUserId: installationIdentity.adminUserId })
    .from(installationIdentity).where(eq(installationIdentity.id, 1)).for("update");
  if (!installation) return unavailable();
  const memberIds = [...new Set([installation.adminUserId, userId])].sort();
  const accountIds = [...new Set([...memberIds, ...(scope.intendedUserId ? [scope.intendedUserId] : [])])].sort();
  const accounts = new Map<string, Readonly<{ userId: string; email: string }>>();
  for (const id of accountIds) {
    const [account] = await tx.select({ userId: user.id, email: user.email }).from(user).where(eq(user.id, id)).for("update");
    if (!account || account.userId !== id) return unavailable();
    accounts.set(id, account);
  }
  const statuses = new Map<string, "active" | "removed">();
  const revisions = new Map<string, number>();
  for (const id of memberIds) {
    const [member] = await tx.select({ status: membership.status, activationRevision: membership.activationRevision }).from(membership).where(eq(membership.userId, id)).for("update");
    if (member) {
      if ((member.status !== "active" && member.status !== "removed") || !Number.isInteger(member.activationRevision)
        || member.activationRevision < 1 || member.activationRevision > 2147483647) return unavailable();
      statuses.set(id, member.status); revisions.set(id, member.activationRevision);
    }
  }
  const account = accounts.get(userId);
  if (!account || statuses.get(installation.adminUserId) !== "active" || (scope.adminOnly && installation.adminUserId !== userId)) return unavailable();
  return { ...account, membershipStatus: statuses.get(userId), activationRevision: revisions.get(userId) };
}

/** Concrete Drizzle transactions; the only injection is the current Database's
 * transaction method. No services/env/connection are imported or initialized.
 * All failures are intentionally opaque, including driver errors with SQL params.
 */
export function createEnrollmentService(db: Pick<Database, "transaction">) {
  async function safely<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw new EnrollmentUnavailableError();
    }
  }

  return {
    issueInvitation(actor: EnrollmentActor, input: unknown) {
      return safely(async () => {
        const userId = actorId(actor);
        const fields = body(input, ["intendedEmail"], ["intendedUserId"]);
        if (typeof fields.intendedEmail !== "string" || !/^[^\s@]+@[^\s@]+$/.test(fields.intendedEmail)) return unavailable();
        if (fields.intendedUserId !== undefined && !nonempty(fields.intendedUserId)) return unavailable();
        const intendedEmail = fields.intendedEmail.toLowerCase();
        const intendedUserId = typeof fields.intendedUserId === "string" ? fields.intendedUserId : null;
        return db.transaction(async (tx) => {
          await lockIdentity(tx, userId, { adminOnly: true, intendedUserId });
          const token = randomBytes(32).toString("base64url");
          const [issued] = await tx.insert(invitation).values({
            id: uuidv7(), tokenHash: tokenHash(token), intendedEmail, intendedUserId, issuedByUserId: userId,
            createdAt: sql`statement_timestamp()`, expiresAt: sql`statement_timestamp() + interval '24 hours'`,
          }).returning({ invitationId: invitation.id, expiresAt: invitation.expiresAt });
          if (!issued) return unavailable();
          await audit(tx, "invite-issued", userId, issued.invitationId, intendedUserId);
          // This is the sole raw-token response. No other operation returns token data.
          return { ...issued, token };
        }, { isolationLevel: "read committed" });
      });
    },

    revokeInvitation(actor: EnrollmentActor, input: unknown) {
      return safely(async () => {
        const userId = actorId(actor);
        const fields = body(input, ["invitationId"]);
        if (!nonempty(fields.invitationId)) return unavailable();
        const invitationId = fields.invitationId;
        return db.transaction(async (tx) => {
          await lockIdentity(tx, userId, { adminOnly: true });
          const [revoked] = await tx.update(invitation).set({ revokedAt: sql`clock_timestamp()` })
            .where(and(eq(invitation.id, invitationId), isNull(invitation.revokedAt), isNull(invitation.consumedAt),
              gt(invitation.expiresAt, sql`clock_timestamp()`)))
            .returning({ invitationId: invitation.id });
          if (!revoked) return unavailable();
          await audit(tx, "invite-revoked", userId, revoked.invitationId, null);
          return revoked;
        }, { isolationLevel: "read committed" });
      });
    },

    acceptInvitation(actor: EnrollmentActor, input: unknown) {
      return safely(async () => {
        const userId = actorId(actor);
        const fields = body(input, ["token"]);
        if (typeof fields.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(fields.token)
          || Buffer.from(fields.token, "base64url").toString("base64url") !== fields.token) return unavailable();
        const hash = tokenHash(fields.token);
        return db.transaction(async (tx) => {
          const account = await lockIdentity(tx, userId, { adminOnly: false });
          // Do not consume an invitation when membership is already active.
          if (account.membershipStatus === "active" || account.activationRevision === 2147483647) return unavailable();
          const nextRevision = (account.activationRevision ?? 0) + 1;
          const [claimed] = await tx.update(invitation)
            .set({ consumedAt: sql`clock_timestamp()`, consumedByUserId: account.userId })
            .where(and(eq(invitation.tokenHash, hash), eq(invitation.intendedEmail, account.email.toLowerCase()),
              or(isNull(invitation.intendedUserId), eq(invitation.intendedUserId, account.userId)),
              isNull(invitation.revokedAt), isNull(invitation.consumedAt), isNull(invitation.consumedByUserId),
              gt(invitation.expiresAt, sql`clock_timestamp()`)))
            .returning({ invitationId: invitation.id });
          if (!claimed) return unavailable();
          // One persistent membership row; reactivation changes identity state only.
          // Never resume schedules or mark any readiness evidence satisfied here.
          const [activated] = await tx.insert(membership).values({
            userId: account.userId, activationRevision: 1, status: "active", joinedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, removedAt: null,
          }).onConflictDoUpdate({
            target: membership.userId,
            set: { activationRevision: nextRevision, status: "active", removedAt: null, updatedAt: sql`clock_timestamp()` },
            setWhere: and(eq(membership.status, "removed"), eq(membership.activationRevision, account.activationRevision ?? 0)) ?? unavailable(),
          }).returning({ userId: membership.userId });
          if (!activated) return unavailable();
          await audit(tx, "invite-consumed", account.userId, claimed.invitationId, account.userId);
          return activated;
        }, { isolationLevel: "read committed" });
      });
    },
  };
}

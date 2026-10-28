import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, eq, or, sql } from "@zetta/db/query";
import { session, user } from "@zetta/db/schema/auth";
import { identityAudit, installationIdentity, membership } from "@zetta/db/schema/identity";

export class AdminLifecycleUnavailableError extends Error {
  constructor() {
    super("Admin lifecycle operation is unavailable. Ask the installation operator to verify the current admin and selected existing accounts before retrying.");
    this.name = "AdminLifecycleUnavailableError";
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function unavailable(): never {
  throw new AdminLifecycleUnavailableError();
}

function fields(input: unknown, keys: string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return unavailable();
  const actual = Object.keys(input);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) return unavailable();
  return input as Record<string, unknown>;
}

function exactId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return unavailable();
  return value;
}

async function lockInstallation(tx: Transaction) {
  const [installation] = await tx.select({ adminUserId: installationIdentity.adminUserId })
    .from(installationIdentity).where(eq(installationIdentity.id, 1)).for("update");
  return installation;
}

async function lockAccount(tx: Transaction, userId: string) {
  const [account] = await tx.select({ userId: user.id }).from(user).where(eq(user.id, userId)).for("update");
  if (!account || account.userId !== userId) return unavailable();
}

async function lockMembership(tx: Transaction, userId: string) {
  const [existing] = await tx.select({ status: membership.status, activationRevision: membership.activationRevision }).from(membership)
    .where(eq(membership.userId, userId)).for("update");
  if (existing && ((existing.status !== "active" && existing.status !== "removed") || !Number.isInteger(existing.activationRevision)
    || existing.activationRevision < 1 || existing.activationRevision > 2147483647)) return unavailable();
  return existing;
}

async function activateMembership(tx: Transaction, userId: string, existing: { status: "active" | "removed"; activationRevision: number } | undefined) {
  if (existing?.status === "active") return;
  if (existing?.activationRevision === 2147483647) return unavailable();
  const nextRevision = (existing?.activationRevision ?? 0) + 1;
  // Re-enrollment only: preserve joined_at and never restore schedules/readiness.
  const [activated] = await tx.insert(membership).values({
    userId, activationRevision: 1, status: "active", joinedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, removedAt: null,
  }).onConflictDoUpdate({
    target: membership.userId,
    set: { activationRevision: nextRevision, status: "active", removedAt: null, updatedAt: sql`clock_timestamp()` },
    setWhere: and(eq(membership.status, "removed"), eq(membership.activationRevision, existing?.activationRevision ?? 0)) ?? unavailable(),
  }).returning({ userId: membership.userId });
  if (!activated || activated.userId !== userId) return unavailable();
}

async function audit(tx: Transaction, eventKind: "bootstrap" | "admin-replacement", subjectUserId: string, operatorReason: string | null) {
  await tx.insert(identityAudit).values({
    id: uuidv7(), eventKind, actorKind: "operator", actorUserId: null, subjectUserId,
    invitationId: null, occurredAt: sql`clock_timestamp()`, operatorReason,
  });
}

/** Internal existing-account operations, NOT an authentication/public API boundary.
 * Future trusted operator composition must establish operator control before calling.
 * No input flag, session identity or ordinary signup may confer that authority.
 * Importing this module never starts services, auth, environment or a connection.
 */
export function createAdminLifecycleService(db: Pick<Database, "transaction">) {
  async function safely<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      // Never propagate driver causes, SQL parameters or distinguishing denials.
      throw new AdminLifecycleUnavailableError();
    }
  }

  return {
    bootstrapExistingAccount(input: unknown) {
      return safely(async () => {
        const userId = exactId(fields(input, ["userId"]).userId);
        return db.transaction(async (tx) => {
          if (await lockInstallation(tx)) return unavailable();
          await lockAccount(tx, userId);
          await activateMembership(tx, userId, await lockMembership(tx, userId));
          // A missing row lock cannot exclude another bootstrap. The unique ID 1
          // insertion decides the winner; a collision must roll back activation.
          const [created] = await tx.insert(installationIdentity).values({
            id: 1, adminUserId: userId, adminMembershipStatus: "active", bootstrappedAt: sql`clock_timestamp()`,
          }).returning({ adminUserId: installationIdentity.adminUserId });
          if (!created || created.adminUserId !== userId) return unavailable();
          await audit(tx, "bootstrap", userId, null);
          return { adminUserId: userId };
        }, { isolationLevel: "read committed" });
      });
    },

    replaceAdminWithExistingAccount(input: unknown) {
      return safely(async () => {
        const value = fields(input, ["expectedAdminUserId", "newAdminUserId", "reason"]);
        const expectedAdminUserId = exactId(value.expectedAdminUserId);
        const newAdminUserId = exactId(value.newAdminUserId);
        if (expectedAdminUserId === newAdminUserId || typeof value.reason !== "string" || !value.reason.trim()) return unavailable();
        const reason = value.reason.trim();
        return db.transaction(async (tx) => {
          // Shared with 004b: singleton FIRST serializes all enrolled-identity
          // operations. Within this lock, account and membership IDs each sort
          // lexically, independent of which account is the old/new admin.
          const installation = await lockInstallation(tx);
          if (!installation || installation.adminUserId !== expectedAdminUserId) return unavailable();
          const userIds = [expectedAdminUserId, newAdminUserId].sort();
          for (const userId of userIds) await lockAccount(tx, userId);
          const memberships = new Map<string, Awaited<ReturnType<typeof lockMembership>>>();
          for (const userId of userIds) memberships.set(userId, await lockMembership(tx, userId));
          if (memberships.get(expectedAdminUserId)?.status !== "active") return unavailable();
          await activateMembership(tx, newAdminUserId, memberships.get(newAdminUserId));
          const [replaced] = await tx.update(installationIdentity).set({ adminUserId: newAdminUserId })
            .where(and(eq(installationIdentity.id, 1), eq(installationIdentity.adminUserId, expectedAdminUserId)))
            .returning({ adminUserId: installationIdentity.adminUserId });
          if (!replaced || replaced.adminUserId !== newAdminUserId) return unavailable();
          // Previous admin remains an ordinary active member, with no private
          // resources transferred. Delete both users' stored sessions atomically.
          await tx.delete(session).where(or(eq(session.userId, expectedAdminUserId), eq(session.userId, newAdminUserId)));
          await audit(tx, "admin-replacement", newAdminUserId, reason);
          return { previousAdminUserId: expectedAdminUserId, adminUserId: newAdminUserId };
        }, { isolationLevel: "read committed" });
      });
    },
  };
}

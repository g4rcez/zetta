import { createHash } from "node:crypto";
import type { InvitationSignupVerifier } from "@zetta/auth/invitation-policy";
import type { Database } from "@zetta/db";
import { and, eq, gt, isNull, sql } from "@zetta/db/query";
import { installationIdentity, invitation, membership } from "@zetta/db/schema/identity";

/** Read-only new-account preflight using the installed Drizzle builder. No
 * connection/env imports, token consumption, membership writes or auth wiring.
 * Existing-user-bound invitations require signin + authenticated acceptance;
 * even a matching proposed ID cannot authorize a new unauthenticated identity.
 * This snapshot cannot guarantee acceptance after expiry, revocation or races.
 */
export function createInvitationSignupPreflight(db: Pick<Database, "select">): InvitationSignupVerifier {
  return async (input) => {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some((key) => key !== "token" && key !== "email")) return false;
      const { token, email } = input;
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)
        || Buffer.from(token, "base64url").toString("base64url") !== token
        || typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email)) return false;
      const hash = createHash("sha256").update(token).digest("hex");
      const [available] = await db.select({ ready: sql<boolean>`true` }).from(invitation)
        .innerJoin(installationIdentity, eq(installationIdentity.id, 1))
        .innerJoin(membership, and(eq(membership.userId, installationIdentity.adminUserId), eq(membership.status, "active")))
        .where(and(eq(invitation.tokenHash, hash), eq(invitation.intendedEmail, email.toLowerCase()),
          isNull(invitation.intendedUserId), isNull(invitation.revokedAt), isNull(invitation.consumedAt),
          isNull(invitation.consumedByUserId), gt(invitation.expiresAt, sql`clock_timestamp()`)))
        .limit(1);
      return available?.ready === true;
    } catch {
      // Never surface driver causes/SQL params, hashes or account-specific reasons.
      return false;
    }
  };
}

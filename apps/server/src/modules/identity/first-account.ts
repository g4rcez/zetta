import type { FirstAccountSetup } from "@zetta/auth/invitation-policy";
import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { account, session, user } from "@zetta/db/schema/auth";
import { installationIdentity } from "@zetta/db/schema/identity";
import { createAdminLifecycleService } from "./admin-lifecycle";

/** Setup is open until an installation (admin) row exists. */
export function createSetupState(db: Pick<Database, "select">) {
  return async () => {
    const [installed] = await db.select({ id: installationIdentity.id }).from(installationIdentity).where(eq(installationIdentity.id, 1)).limit(1);
    return !installed;
  };
}

/** The first account becomes root/admin without an invitation; the unique installation row decides concurrent winners. */
export function createFirstAccountSetup(db: Pick<Database, "select" | "transaction" | "delete">): FirstAccountSetup {
  const admin = createAdminLifecycleService(db);
  return {
    isOpen: createSetupState(db),
    claim: async (userId) => { await admin.bootstrapExistingAccount({ userId }); },
    discard: async (userId) => {
      await db.transaction(async (tx) => {
        await tx.delete(session).where(eq(session.userId, userId));
        await tx.delete(account).where(eq(account.userId, userId));
        await tx.delete(user).where(eq(user.id, userId));
      });
    },
  };
}

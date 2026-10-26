import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { installationIdentity, membership } from "@zetta/db/schema/identity";

export type SessionSource = { api: { getSession(input: { headers: Headers }): Promise<{ user: { id: string } } | null> } };
export type IdentityStatus = Readonly<{ state: "anonymous" } | { state: "unenrolled"; userId: string } | { state: "active"; userId: string; isAdmin: boolean }>;
export type MembershipLookup = (userId: string) => Promise<{ isAdmin: boolean } | null>;
export type ActiveActor = Readonly<{ userId: string; isAdmin: boolean }>;
const issuedActors = new WeakSet<ActiveActor>();

export class AccessError extends Error {
  constructor(public readonly code: "SIGN_IN_REQUIRED" | "ACCESS_DENIED" | "NOT_FOUND" | "IDENTITY_UNAVAILABLE") {
    super(code === "SIGN_IN_REQUIRED" ? "Sign in to continue." : code === "NOT_FOUND" ? "Resource not found." : code === "IDENTITY_UNAVAILABLE" ? "Unable to check access. Please retry." : "An active membership is required. Ask the administrator for an invitation.");
  }
}

export function createMembershipLookup(db: Pick<Database, "select">): MembershipLookup {
  return async (userId) => {
    const [row] = await db.select({ adminUserId: installationIdentity.adminUserId }).from(membership)
      .leftJoin(installationIdentity, eq(installationIdentity.id, 1))
      .where(and(eq(membership.userId, userId), eq(membership.status, "active"))).limit(1);
    return row ? { isAdmin: row.adminUserId === userId } : null;
  };
}

export function createIdentityAccess(auth: SessionSource, lookup: MembershipLookup) {
  async function sessionActor(headers: Headers): Promise<Readonly<{ userId: string }>> {
    let session;
    try { session = await auth.api.getSession({ headers }); } catch { throw new AccessError("IDENTITY_UNAVAILABLE"); }
    if (!session?.user.id) throw new AccessError("SIGN_IN_REQUIRED");
    return Object.freeze({ userId: session.user.id });
  }
  async function status(headers: Headers): Promise<IdentityStatus> {
    let actor;
    try { actor = await sessionActor(headers); } catch (error) {
      if (error instanceof AccessError && error.code === "SIGN_IN_REQUIRED") return Object.freeze({ state: "anonymous" });
      throw error;
    }
    let member;
    try { member = await lookup(actor.userId); } catch { throw new AccessError("IDENTITY_UNAVAILABLE"); }
    return Object.freeze(member ? { state: "active", userId: actor.userId, isAdmin: member.isAdmin } : { state: "unenrolled", userId: actor.userId });
  }
  async function requireActive(headers: Headers): Promise<ActiveActor> {
    const identity = await status(headers);
    if (identity.state === "anonymous") throw new AccessError("SIGN_IN_REQUIRED");
    if (identity.state !== "active") throw new AccessError("ACCESS_DENIED");
    const actor = Object.freeze({ userId: identity.userId, isAdmin: identity.isAdmin });
    issuedActors.add(actor);
    return actor;
  }
  return { status, sessionActor, requireActive };
}

/**
 * Server-side work done on a user's behalf outside a request (schedulers such as Agenda sync). The membership is re-checked on every call,
 * so a removed member's background work stops. Never derive `userId` from request input: only from rows the user already owns.
 */
export async function issueBackgroundActor(lookup: MembershipLookup, userId: string): Promise<ActiveActor | null> {
  const member = await lookup(userId).catch(() => null);
  if (!member) return null;
  const actor = Object.freeze({ userId, isAdmin: member.isAdmin });
  issuedActors.add(actor);
  return actor;
}

/** Scope database reads by actor.userId first; these checks also reject substituted nested references.
 * Resolve a fresh actor per request/dispatch. Never retain one as a session cache.
 */
export function requireOwned<T extends { ownerUserId: string }>(actor: ActiveActor, resource: T | null | undefined): T {
  if (!issuedActors.has(actor) || !resource || resource.ownerUserId !== actor.userId) throw new AccessError("NOT_FOUND");
  return resource;
}

export function requireOwnedChild<P extends { id: string; ownerUserId: string }, C extends { parentId: string; ownerUserId: string }>(actor: ActiveActor, parent: P | null | undefined, child: C | null | undefined): C {
  const ownedParent = requireOwned(actor, parent);
  const ownedChild = requireOwned(actor, child);
  if (ownedChild.parentId !== ownedParent.id) throw new AccessError("NOT_FOUND");
  return ownedChild;
}

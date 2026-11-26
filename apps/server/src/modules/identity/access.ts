import type { WorkspaceRole } from "@zetta/core/workspace";
import { tenant, type Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { installationIdentity, membership } from "@zetta/db/schema/identity";

export type SessionSource = {
  api: { getSession(input: { headers: Headers }): Promise<{ user: { id: string } } | null> };
};
/**
 * Where a person stands. `isAdmin` says they administer their workspace (its owner or one of its administrators). The rest comes from the
 * workspace lookup (modules/workspaces/lookup.ts) and is absent from a lookup that knows only the membership: `isRoot` is the one person
 * who set this server up, `workspaceId` and `role` their place in a workspace.
 */
export type Standing = Readonly<{
  isAdmin: boolean;
  isRoot?: boolean;
  workspaceId?: string;
  role?: WorkspaceRole;
  /**
   * `nowhere`: the person had a place in a workspace and has none they can work in now (removed, suspended, deleted). Their requests see
   * no workspace's rows. A person with no place ever (data from before workspaces) has no `place`.
   */
  place?: "nowhere";
}>;
export type IdentityStatus = Readonly<
  { state: "anonymous" } | { state: "unenrolled"; userId: string } | ActiveIdentity
>;
type ActiveIdentity = { state: "active"; userId: string } & Standing;
/**
 * Where a person stands. With `workspace` (its id or slug), in that workspace: null when they are not an active member of it. Without, in
 * the workspace they joined first.
 */
export type MembershipLookup = (userId: string, workspace?: string) => Promise<Standing | null>;
export type ActiveActor = Readonly<{ userId: string } & Standing>;

/** What belongs to the whole server (its settings, the keys of its own services) is root's. An actor that carries no `isRoot` comes from a
 * lookup with one administrator, who is root. */
export const isRoot = (actor: Standing) => actor.isRoot ?? actor.isAdmin;

/** The standing with only the fields the lookup gave, so an answer built from it shows no empty keys. */
function standing(member: Standing): Standing {
  return {
    isAdmin: member.isAdmin,
    ...(member.isRoot === undefined ? {} : { isRoot: member.isRoot }),
    ...(member.workspaceId === undefined ? {} : { workspaceId: member.workspaceId }),
    ...(member.role === undefined ? {} : { role: member.role }),
    ...(member.place === undefined ? {} : { place: member.place }),
  };
}
const issuedActors = new WeakSet<ActiveActor>();

export class AccessError extends Error {
  constructor(
    public readonly code:
      | "SIGN_IN_REQUIRED"
      | "ACCESS_DENIED"
      | "NOT_FOUND"
      | "IDENTITY_UNAVAILABLE",
  ) {
    super(
      code === "SIGN_IN_REQUIRED"
        ? "Sign in to continue."
        : code === "NOT_FOUND"
          ? "Resource not found."
          : code === "IDENTITY_UNAVAILABLE"
            ? "Unable to check access. Please retry."
            : "An active membership is required. Ask the administrator for an invitation.",
    );
  }
}

export function createMembershipLookup(db: Pick<Database, "select">): MembershipLookup {
  return async (userId) => {
    const [row] = await db
      .select({ adminUserId: installationIdentity.adminUserId })
      .from(membership)
      .leftJoin(installationIdentity, eq(installationIdentity.id, 1))
      .where(and(eq(membership.userId, userId), eq(membership.status, "active")))
      .limit(1);
    return row ? { isAdmin: row.adminUserId === userId } : null;
  };
}

export function createIdentityAccess(auth: SessionSource, lookup: MembershipLookup) {
  async function sessionActor(headers: Headers): Promise<Readonly<{ userId: string }>> {
    let session;
    try {
      session = await auth.api.getSession({ headers });
    } catch {
      throw new AccessError("IDENTITY_UNAVAILABLE");
    }
    if (!session?.user.id) throw new AccessError("SIGN_IN_REQUIRED");
    return Object.freeze({ userId: session.user.id });
  }
  async function status(headers: Headers): Promise<IdentityStatus> {
    let actor;
    try {
      actor = await sessionActor(headers);
    } catch (error) {
      if (error instanceof AccessError && error.code === "SIGN_IN_REQUIRED")
        return Object.freeze({ state: "anonymous" });
      throw error;
    }
    let member;
    try {
      // The workspace the request asked for, when the person is in it; otherwise the one they joined first (a removed member's old
      // address lands them where they still are).
      const requested = tenant.requested();
      member =
        (requested ? await lookup(actor.userId, requested) : null) ?? (await lookup(actor.userId));
    } catch {
      throw new AccessError("IDENTITY_UNAVAILABLE");
    }
    return Object.freeze(
      member
        ? { state: "active", userId: actor.userId, ...standing(member) }
        : { state: "unenrolled", userId: actor.userId },
    );
  }
  async function requireActive(headers: Headers): Promise<ActiveActor> {
    const identity = await status(headers);
    if (identity.state === "anonymous") throw new AccessError("SIGN_IN_REQUIRED");
    if (identity.state !== "active") throw new AccessError("ACCESS_DENIED");
    const actor = Object.freeze({ userId: identity.userId, ...standing(identity) });
    issuedActors.add(actor);
    // From here on the request reads and writes its person's workspace (packages/db/src/tenant.ts); a person who stands in none sees no
    // workspace's rows, never the first one's.
    if (actor.workspaceId) tenant.claim(actor.workspaceId);
    else if (actor.place === "nowhere") tenant.claimNowhere();
    return actor;
  }
  return { status, sessionActor, requireActive };
}

/**
 * Server-side work done on a user's behalf outside a request (schedulers such as Agenda sync). The membership is re-checked on every call,
 * so a removed member's background work stops. Never derive `userId` from request input: only from rows the user already owns.
 *
 * The actor stands in the workspace the work runs for (packages/db/src/tenant.ts): a scheduler runs each workspace apart, a request its
 * person's. A person who is no longer in that workspace gets no actor there, so their work in it stops too.
 */
export async function issueBackgroundActor(
  lookup: MembershipLookup,
  userId: string,
): Promise<ActiveActor | null> {
  // The workspace the work runs for; in a request that has none yet (MCP), the one it asked for.
  const workspace = tenant.current() ?? tenant.requested();
  const member = await lookup(userId, workspace).catch(() => null);
  if (!member) return null;
  const actor = Object.freeze({ userId, ...standing(member) });
  issuedActors.add(actor);
  // A request that names its person by a token, not a session (MCP), works in that person's workspace from here on.
  if (actor.workspaceId) tenant.claimIfOpen(actor.workspaceId);
  return actor;
}

/** Scope database reads by actor.userId first; these checks also reject substituted nested references.
 * Resolve a fresh actor per request/dispatch. Never retain one as a session cache.
 */
export function requireOwned<T extends { ownerUserId: string }>(
  actor: ActiveActor,
  resource: T | null | undefined,
): T {
  if (!issuedActors.has(actor) || !resource || resource.ownerUserId !== actor.userId)
    throw new AccessError("NOT_FOUND");
  return resource;
}

/**
 * For a resource the actor reaches through a team. `isMember` must come from the live team membership check (teams/people.ts), never
 * from request input. Read-only paths use it; writes keep `requireOwned` until a phase opens them to members.
 */
export function requireTeamMember<T>(
  actor: ActiveActor,
  resource: T | null | undefined,
  isMember: boolean,
): T {
  if (!issuedActors.has(actor) || !resource || !isMember) throw new AccessError("NOT_FOUND");
  return resource;
}

export function requireOwnedChild<
  P extends { id: string; ownerUserId: string },
  C extends { parentId: string; ownerUserId: string },
>(actor: ActiveActor, parent: P | null | undefined, child: C | null | undefined): C {
  const ownedParent = requireOwned(actor, parent);
  const ownedChild = requireOwned(actor, child);
  if (ownedChild.parentId !== ownedParent.id) throw new AccessError("NOT_FOUND");
  return ownedChild;
}

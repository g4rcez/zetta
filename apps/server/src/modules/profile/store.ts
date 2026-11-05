import { parseAvatar, type AvatarValue } from "@zetta/core/avatar";
import type { Database } from "@zetta/db";
import { and, desc, eq, gt } from "@zetta/db/query";
import { session, user } from "@zetta/db/schema/auth";
import { userPreference } from "@zetta/db/schema/preferences";
import { AccessError, type ActiveActor } from "../identity/access";

export type Profile = { name: string; email: string; avatar: AvatarValue | null };
export type ProfilePatch = { name?: string; avatar?: AvatarValue | null };
/** One place the person is signed in. `device` says whether it is the browser that asked. The session token is never part of it. */
export type SessionRow = {
  id: string;
  device: "this" | "other";
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
};

export function createProfileStore(db: Database) {
  async function get(a: ActiveActor): Promise<Profile> {
    const [row] = await db
      .select({ name: user.name, email: user.email, avatar: userPreference.avatar })
      .from(user)
      .leftJoin(userPreference, eq(userPreference.ownerUserId, user.id))
      .where(eq(user.id, a.userId));
    if (!row) throw new AccessError("NOT_FOUND");
    return { name: row.name, email: row.email, avatar: parseAvatar(row.avatar) };
  }
  return {
    get,
    async update(a: ActiveActor, patch: ProfilePatch): Promise<Profile> {
      await db.transaction(async (tx) => {
        if (patch.name !== undefined)
          await tx
            .update(user)
            .set({ name: patch.name, updatedAt: new Date() })
            .where(eq(user.id, a.userId));
        if (patch.avatar !== undefined)
          await tx
            .insert(userPreference)
            .values({ ownerUserId: a.userId, avatar: patch.avatar })
            .onConflictDoUpdate({
              target: userPreference.ownerUserId,
              set: { avatar: patch.avatar, updatedAt: new Date() },
            });
      });
      return get(a);
    },
    /** The person's own sessions that have not expired: this browser first, then the newest. */
    async sessions(a: ActiveActor, currentId: string | undefined): Promise<SessionRow[]> {
      const rows = await db
        .select({
          id: session.id,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
          createdAt: session.createdAt,
        })
        .from(session)
        .where(and(eq(session.userId, a.userId), gt(session.expiresAt, new Date())))
        .orderBy(desc(session.createdAt));
      const list = rows.map((r) => ({
        ...r,
        device: r.id === currentId ? ("this" as const) : ("other" as const),
      }));
      return [
        ...list.filter((r) => r.device === "this"),
        ...list.filter((r) => r.device === "other"),
      ];
    },
  };
}
export type ProfileStore = ReturnType<typeof createProfileStore>;

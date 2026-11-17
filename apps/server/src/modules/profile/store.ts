import { parseAvatar, type AvatarValue } from "@zetta/core/avatar";
import type { ProfileLines } from "@zetta/core/person-profile";
import type { Database } from "@zetta/db";
import { and, desc, eq, gt } from "@zetta/db/query";
import { session, user } from "@zetta/db/schema/auth";
import { userPreference } from "@zetta/db/schema/preferences";
import { AccessError, type ActiveActor } from "../identity/access";

export type Profile = {
  name: string;
  email: string;
  avatar: AvatarValue | null;
} & ProfileLines;
export type ProfilePatch = { name?: string; avatar?: AvatarValue | null } & Partial<ProfileLines>;
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
      .select({
        name: user.name,
        email: user.email,
        avatar: userPreference.avatar,
        jobTitle: userPreference.jobTitle,
        department: userPreference.department,
        about: userPreference.about,
        timezone: userPreference.timezone,
        contact: userPreference.contact,
      })
      .from(user)
      .leftJoin(userPreference, eq(userPreference.ownerUserId, user.id))
      .where(eq(user.id, a.userId));
    if (!row) throw new AccessError("NOT_FOUND");
    // No preference row yet: every line is "not written".
    return {
      name: row.name,
      email: row.email,
      avatar: parseAvatar(row.avatar),
      jobTitle: row.jobTitle ?? "",
      department: row.department ?? "",
      about: row.about ?? "",
      timezone: row.timezone ?? "",
      contact: row.contact ?? "",
    };
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
        // The picture and the profile lines live in the preference row: one upsert for whatever of them changed.
        const lines = {
          ...(patch.avatar !== undefined && { avatar: patch.avatar }),
          ...(patch.jobTitle !== undefined && { jobTitle: patch.jobTitle }),
          ...(patch.department !== undefined && { department: patch.department }),
          ...(patch.about !== undefined && { about: patch.about }),
          ...(patch.timezone !== undefined && { timezone: patch.timezone }),
          ...(patch.contact !== undefined && { contact: patch.contact }),
        };
        if (Object.keys(lines).length > 0)
          await tx
            .insert(userPreference)
            .values({ ownerUserId: a.userId, ...lines })
            .onConflictDoUpdate({
              target: userPreference.ownerUserId,
              set: { ...lines, updatedAt: new Date() },
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

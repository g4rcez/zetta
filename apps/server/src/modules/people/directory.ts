import { personTitle } from "@zetta/core/person-profile";
import type { Database } from "@zetta/db";
import { and, asc, eq, inArray } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { orgPosition } from "@zetta/db/schema/org";
import { userPreference } from "@zetta/db/schema/preferences";
import { avatarOut } from "../avatars/out";

type Avatar = (typeof userPreference.$inferSelect)["avatar"];

/**
 * What the installation's members may read about each other. There is no email: a member sees names, pictures and the lines a person
 * wrote about themselves. `title` is what to show under a name: the person's own job title, else the title of the company-chart seat
 * they hold, else empty.
 */
export type PersonCard = {
  userId: string;
  name: string;
  avatar: Avatar;
  jobTitle: string;
  title: string;
  department: string;
  about: string;
  contact: string;
};
/** The lines that go next to a name in the lists that already carry people. */
export type PersonLine = Pick<PersonCard, "avatar" | "title">;

export function createPeopleDirectory(db: Pick<Database, "select">) {
  /** The title of the first seat each person holds in the company chart (the one that sorts first). */
  async function seatTitles(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await db
      .select({ userId: orgPosition.userId, title: orgPosition.title })
      .from(orgPosition)
      .where(and(eq(orgPosition.seat, "person"), inArray(orgPosition.userId, userIds)))
      .orderBy(asc(orgPosition.sortOrder), asc(orgPosition.id));
    const out = new Map<string, string>();
    for (const r of rows) if (r.userId && !out.has(r.userId)) out.set(r.userId, r.title);
    return out;
  }

  async function cards(userIds: string[]): Promise<Map<string, PersonCard>> {
    const wanted = [...new Set(userIds)];
    if (wanted.length === 0) return new Map();
    const [rows, seats] = await Promise.all([
      db
        .select({
          userId: user.id,
          name: user.name,
          avatar: userPreference.avatar,
          jobTitle: userPreference.jobTitle,
          department: userPreference.department,
          about: userPreference.about,
          contact: userPreference.contact,
        })
        .from(user)
        .leftJoin(userPreference, eq(userPreference.ownerUserId, user.id))
        .where(inArray(user.id, wanted)),
      seatTitles(wanted),
    ]);
    return new Map(
      rows.map((r) => [
        r.userId,
        {
          userId: r.userId,
          name: r.name,
          avatar: avatarOut("user", r.userId, r.avatar),
          jobTitle: r.jobTitle ?? "",
          title: personTitle(r.jobTitle, seats.get(r.userId)),
          department: r.department ?? "",
          about: r.about ?? "",
          contact: r.contact ?? "",
        },
      ]),
    );
  }

  return {
    cards,
    /** Avatar and title of each person, for the lists that already carry names. Someone unknown reads as no picture and no title. */
    async lines(userIds: string[]): Promise<Map<string, PersonLine>> {
      const found = await cards(userIds);
      return new Map([...found].map(([id, c]) => [id, { avatar: c.avatar, title: c.title }]));
    },
    /** Every active member of the installation, by name. */
    async list(): Promise<PersonCard[]> {
      const members = await db
        .select({ userId: membership.userId })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(eq(membership.status, "active"))
        .orderBy(asc(user.name), asc(user.id));
      const found = await cards(members.map((m) => m.userId));
      return members.flatMap((m) => {
        const c = found.get(m.userId);
        return c ? [c] : [];
      });
    },
  };
}
export type PeopleDirectory = ReturnType<typeof createPeopleDirectory>;

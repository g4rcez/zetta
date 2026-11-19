import { isAvatarValue, parseAvatarRef, type AvatarValue } from "@zetta/core/avatar";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { userPreference } from "@zetta/db/schema/preferences";
import type { ActiveActor } from "../identity/access";

/** A picture sent back as one of our links that names nothing: an unknown, archived or malformed id. */
export class AvatarRefError extends Error {
  constructor() {
    super("That picture is not available.");
    this.name = "AvatarRefError";
  }
}

/** `store.resolve`, or, with no store (a process that cannot read pictures), a refusal of any link: a link is never stored. */
export async function resolveAvatar<A extends AvatarValue | null | undefined>(
  store: AvatarStore | undefined,
  actor: ActiveActor,
  avatar: A,
): Promise<A> {
  if (store) return store.resolve(actor, avatar);
  if (avatar && avatar.kind === "image" && parseAvatarRef(avatar.src)) throw new AvatarRefError();
  return avatar;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads the stored pictures behind `/api/avatars/{bot|user}/<id>`. A picture is public to the organization: any active member may
 * load the picture of any bot or person, whoever owns it and however it is shared, because names and pictures are what members see of
 * each other everywhere. Nothing is served for an archived bot, an unknown id or a member who left.
 */
export function createAvatarStore(db: Pick<Database, "select">) {
  async function ofBot(id: string): Promise<unknown> {
    const [row] = await db
      .select({ avatar: bot.avatar })
      .from(bot)
      .where(and(eq(bot.id, id), eq(bot.archived, false)));
    return row?.avatar ?? null;
  }
  async function ofUser(id: string): Promise<unknown> {
    const [row] = await db
      .select({ avatar: userPreference.avatar })
      .from(userPreference)
      .innerJoin(membership, eq(membership.userId, userPreference.ownerUserId))
      .where(and(eq(userPreference.ownerUserId, id), eq(membership.status, "active")));
    return row?.avatar ?? null;
  }
  return {
    bot: (_actor: ActiveActor, id: string) => ofBot(id),
    user: (_actor: ActiveActor, id: string) => ofUser(id),
    /**
     * A picture a client sent back, ready to store. The web resends the value it was given, which for an uploaded picture is one of our
     * links, so a link is swapped for the picture it names. Presets and fresh uploads pass through. A link that points at nothing
     * (unknown or archived bot, member who left) throws `AvatarRefError`, so the write is refused instead of storing a dead link.
     */
    async resolve<A extends AvatarValue | null | undefined>(
      _actor: ActiveActor,
      avatar: A,
    ): Promise<A> {
      if (!avatar || avatar.kind !== "image") return avatar;
      const ref = parseAvatarRef(avatar.src);
      if (!ref) return avatar;
      // A person's id is the auth library's text id; a bot's is a uuid, and the database would fail on anything else.
      const stored =
        ref.owner === "bot"
          ? UUID.test(ref.id)
            ? await ofBot(ref.id)
            : null
          : await ofUser(ref.id);
      if (isAvatarValue(stored) && stored.kind === "image") return stored as A;
      throw new AvatarRefError();
    },
  };
}
export type AvatarStore = ReturnType<typeof createAvatarStore>;

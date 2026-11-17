import type { Database } from "@zetta/db";
import { and, eq, inArray } from "@zetta/db/query";
import { attentionItem } from "@zetta/db/schema/features";
import { installationIdentity } from "@zetta/db/schema/identity";
import { closeAttentionIds, raiseAttention } from "../features/attention";
import type { UpdateVerdict } from "./checker";

/** The page the card opens. */
export const UPDATE_PAGE = "/update";
const keyFor = (latest: string) => `update:${latest}`;

/**
 * Keeps the administrator's Catch up card for a new version in step with the check. At most one card is open: a newer version replaces the
 * card of an older one, and a build that is current (or a check that was turned off) closes it. A card the administrator dismissed
 * stays dismissed for that version: the next one to be published raises a new card.
 */
export async function syncUpdateCard(
  db: Pick<Database, "select" | "insert" | "update">,
  verdict: UpdateVerdict,
): Promise<void> {
  const [identity] = await db
    .select({ adminUserId: installationIdentity.adminUserId })
    .from(installationIdentity)
    .where(eq(installationIdentity.id, 1));
  const admin = identity?.adminUserId;
  if (!admin) return;
  const live = await db
    .select({ id: attentionItem.id, sourceKey: attentionItem.sourceKey })
    .from(attentionItem)
    .where(
      and(
        eq(attentionItem.ownerUserId, admin),
        eq(attentionItem.kind, "update_available"),
        inArray(attentionItem.status, ["open", "acknowledged"]),
      ),
    );
  // `unknown` says nothing new: an open card stays until the feed says current, or the check is turned off.
  if (verdict?.state === "unknown") return;
  if (!verdict || verdict.state === "current" || !verdict.latest) {
    await closeAttentionIds(
      db,
      admin,
      live.map((c) => c.id),
      "resolved",
    );
    return;
  }
  const key = keyFor(verdict.latest.date);
  await closeAttentionIds(
    db,
    admin,
    live.filter((c) => c.sourceKey !== key).map((c) => c.id),
    "resolved",
  );
  if (live.some((c) => c.sourceKey === key)) return;
  const [seen] = await db
    .select({ id: attentionItem.id })
    .from(attentionItem)
    .where(and(eq(attentionItem.ownerUserId, admin), eq(attentionItem.sourceKey, key)))
    .limit(1);
  if (seen) return;
  await raiseAttention(db, admin, {
    kind: "update_available",
    title: "A new version of Zetta is available",
    detail: `Changes were published up to ${verdict.latest.date}. See what changed and how to update.`,
    nextAction:
      "Open the update page, read what changed, and run the update command when you are ready.",
    resultLink: UPDATE_PAGE,
    sourceKey: key,
  });
}

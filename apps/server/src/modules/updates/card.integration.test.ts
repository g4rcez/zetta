import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem } from "@zetta/db/schema/features";
import { installationIdentity, membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { buildQueue } from "../catch-up/queue";
import { UPDATE_PAGE, syncUpdateCard } from "./card";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ADMIN = `upd-admin-${uuidv7()}`;
const MEMBER = `upd-member-${uuidv7()}`;
const behind = (date: string) => ({ state: "behind" as const, latest: { date } });

suite("update card against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const cards = (userId = ADMIN) =>
    db
      .select()
      .from(attentionItem)
      .where(
        and(eq(attentionItem.ownerUserId, userId), eq(attentionItem.kind, "update_available")),
      );
  const live = async () =>
    (await cards()).filter((c) => c.status === "open" || c.status === "acknowledged");

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      [ADMIN, MEMBER].map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(membership).values(
      [ADMIN, MEMBER].map((userId) => ({
        userId,
        status: "active" as const,
        joinedAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(installationIdentity)
      .values({ id: 1, adminUserId: ADMIN, bootstrappedAt: now })
      .onConflictDoUpdate({ target: installationIdentity.id, set: { adminUserId: ADMIN } });
  });
  afterAll(async () => {
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    await cleanupTestUsers(db, [ADMIN, MEMBER]);
  });

  test("a newer version raises one card for the administrator, and a repeat adds no second", async () => {
    await syncUpdateCard(db, behind("2026-11-12"));
    await syncUpdateCard(db, behind("2026-11-12"));
    const open = await live();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ resultLink: UPDATE_PAGE, sourceKey: "update:2026-11-12" });
    expect(await cards(MEMBER)).toHaveLength(0);
  });

  test("the card is a decision in the Catch up queue that opens the Update page", async () => {
    const queue = await buildQueue({ db, listProposals: async () => [] }, {
      userId: ADMIN,
      isAdmin: true,
    } as never);
    const item = queue.find((i) => i.source === "card" && i.kind === "update_available");
    expect(item).toMatchObject({ resultLink: UPDATE_PAGE, actions: { act: "open_chat" } });
  });

  test("a still newer version replaces the card instead of adding another", async () => {
    await syncUpdateCard(db, behind("2026-11-14"));
    const open = await live();
    expect(open.map((c) => c.sourceKey)).toEqual(["update:2026-11-14"]);
  });

  test("unknown says nothing new, and the card stays", async () => {
    await syncUpdateCard(db, { state: "unknown", latest: null });
    expect(await live()).toHaveLength(1);
  });

  test("a dismissed card is not raised again for the same version, but is for the next", async () => {
    await db
      .update(attentionItem)
      .set({ status: "cancelled" })
      .where(and(eq(attentionItem.ownerUserId, ADMIN), eq(attentionItem.kind, "update_available")));
    await syncUpdateCard(db, behind("2026-11-14"));
    expect(await live()).toHaveLength(0);
    await syncUpdateCard(db, behind("2026-11-15"));
    expect(await live()).toHaveLength(1);
  });

  test("current resolves the card; so does turning the check off", async () => {
    await syncUpdateCard(db, { state: "current", latest: { date: "2026-11-15" } });
    expect(await live()).toHaveLength(0);
    await syncUpdateCard(db, behind("2026-11-20"));
    expect(await live()).toHaveLength(1);
    await syncUpdateCard(db, null);
    expect(await live()).toHaveLength(0);
  });
});

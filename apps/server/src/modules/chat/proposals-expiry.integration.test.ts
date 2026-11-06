import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { attentionItem, configProposal } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `pexp-a-${uuidv7()}`;
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

suite("a card nobody decides expires", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const fakeRun = Object.assign(async () => ({ text: "done", stopped: false }), {
    stream: async function* () {
      yield "done";
    },
  });
  const chatSvc = createChatService(
    db,
    fakeRun as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      backgroundActor: (userId: string) =>
        issueBackgroundActor(async () => ({ isAdmin: false }) as never, userId),
    },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: chatSvc },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": A,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const card = async (kind: "chief_action" | "bot_permission", expiresAt?: Date) => {
    const [row] = await db
      .insert(configProposal)
      .values({
        ownerUserId: A,
        kind,
        baseVersion: 0,
        patch: { title: "Change something" },
        diff: [],
        ...(expiresAt ? { expiresAt } : {}),
      })
      .returning();
    await db.insert(attentionItem).values({
      ownerUserId: A,
      title: "Approve a change",
      sourceKey: `proposal:${row!.id}`,
      source: "manual",
    });
    return row!.id;
  };
  const statusOf = async (id: string) =>
    (await db.select().from(configProposal).where(eq(configProposal.id, id)))[0]!.status;
  const attentionOf = async (id: string) =>
    (
      await db
        .select()
        .from(attentionItem)
        .where(and(eq(attentionItem.ownerUserId, A), eq(attentionItem.sourceKey, `proposal:${id}`)))
    )[0]!.status;
  const listed = async () =>
    (await call("GET", "/api/proposals")).json.proposals as { id: string; confirm: string }[];

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: A,
      name: A,
      email: `${A}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A]);
  });

  test("a new card waits 24 hours", async () => {
    const id = await card("chief_action");
    const [row] = await db.select().from(configProposal).where(eq(configProposal.id, id));
    const hours = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(24, 1);
  });

  test("a card past its deadline leaves the list and cannot be approved", async () => {
    const id = await card("chief_action", hoursFromNow(-1));
    expect((await listed()).map((p) => p.id)).not.toContain(id);
    const res = await call("POST", `/api/proposals/${id}/decision`, { approve: true });
    expect(res.status).toBe(410);
    expect(res.json.error?.code ?? res.json.code).toBe("PROPOSAL_EXPIRED");
    expect(await statusOf(id)).toBe("expired");
    expect(await attentionOf(id)).toBe("cancelled");
  });

  test("the sweeper closes overdue cards and leaves the others waiting", async () => {
    const overdue = await card("chief_action", hoursFromNow(-2));
    const waiting = await card("chief_action", hoursFromNow(2));
    expect(await chatSvc.expireProposals()).toBeGreaterThanOrEqual(1);
    expect(await statusOf(overdue)).toBe("expired");
    expect(await attentionOf(overdue)).toBe("cancelled");
    expect(await statusOf(waiting)).toBe("pending");
    expect(await attentionOf(waiting)).toBe("open");
  });

  test("a card that changes what a bot may do asks for a hold, the others for a click", async () => {
    const permission = await card("bot_permission", hoursFromNow(3));
    const plain = await card("chief_action", hoursFromNow(3));
    const byId = Object.fromEntries((await listed()).map((p) => [p.id, p.confirm]));
    expect(byId[permission]).toBe("hold");
    expect(byId[plain]).toBe("click");
  });
});

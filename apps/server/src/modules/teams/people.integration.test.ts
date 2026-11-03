import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess, createMembershipLookup } from "../identity/access";
import { createLoopStore } from "../chat/loops";
import { createDiscussionStore } from "../discussions/store";
import { createDiscussionWorker } from "../discussions/worker";
import { createTeamStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const tag = uuidv7().slice(-8);
const OWNER = `people-owner-${tag}`;
const MEMBER = `people-member-${tag}`;
const OUTSIDER = `people-outsider-${tag}`;
const ALL = [OWNER, MEMBER, OUTSIDER];

suite("team people against postgres", () => {
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
    createMembershipLookup(db),
  );
  const fakeRun = Object.assign(async () => ({ text: "ok", stopped: false }), {
    stream: async function* () {
      yield "ok";
    },
  });
  const loops = createLoopStore(db);
  const discussions = createDiscussionStore(db, undefined, loops);
  const chat = createChatService(
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
    { discussions, loops },
  );
  const worker = createDiscussionWorker(db, discussions, chat, createMembershipLookup(db));
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    discussions: { access, store: discussions, worker, chat },
    teams: { access, store: createTeamStore(db, discussions) },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const makeBot = async (name: string) => {
    const b = (await call(OWNER, "POST", "/api/bots", { name })).json.bot as { id: string };
    await db.update(bot).set({ onboarded: true }).where(eq(bot.id, b.id));
    return b;
  };

  let teamId = "";
  let roomId = "";
  let conversationId = "";

  beforeAll(async () => {
    const now = new Date();
    for (const id of ALL) {
      await db.insert(user).values({
        id,
        name: `Name ${id.split("-")[1]}`,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active" as const, joinedAt: now, updatedAt: now });
    }
    const lead = await makeBot("Lead");
    const coder = await makeBot("Coder");
    const made = (await call(OWNER, "POST", "/api/teams", { name: "Crew", goal: "Ship" })).json
      .team;
    teamId = made.id;
    await call(OWNER, "PUT", `/api/teams/${teamId}`, {
      expectedVersion: 1,
      name: "Crew",
      goal: "Ship",
      canvas: { x: 0, y: 0, w: 400, h: 300 },
      members: [
        { botId: lead.id, kind: "chief", roleId: null, canvas: { x: 1, y: 1 } },
        { botId: coder.id, kind: "member", roleId: null, canvas: { x: 2, y: 2 } },
      ],
    });
    roomId = (await call(OWNER, "POST", `/api/teams/${teamId}/rooms`, { title: "Launch" })).json
      .discussionId;
    conversationId = (await call(OWNER, "GET", `/api/discussions/${roomId}`)).json.discussion
      .conversationId;
  });
  afterAll(async () => {
    await worker.drain().catch(() => {});
    await cleanupTestUsers(db, ALL);
  });

  test("a new team has its owner as the only person", async () => {
    const r = await call(OWNER, "GET", `/api/teams/${teamId}/people`);
    expect(r.status).toBe(200);
    expect(r.json.people).toEqual([{ userId: OWNER, name: "Name owner", role: "owner" }]);
  });

  test("a team member cannot read the team's room before the owner adds them", async () => {
    expect((await call(MEMBER, "GET", `/api/discussions/${roomId}`)).status).toBe(404);
    expect(
      (await call(MEMBER, "GET", `/api/conversations/${conversationId}/messages`)).status,
    ).toBe(404);
    expect((await call(MEMBER, "GET", "/api/discussions")).json.discussions).toEqual([]);
  });

  test("the owner adds a member, who then reads the room, its list and its transcript", async () => {
    const before = await call(OWNER, "GET", `/api/teams/${teamId}/candidates`);
    expect(before.json.candidates).toContainEqual({ userId: MEMBER, name: "Name member" });
    const added = await call(OWNER, "POST", `/api/teams/${teamId}/people`, { userId: MEMBER });
    expect(added.status).toBe(201);
    expect(added.json.people).toEqual([
      { userId: OWNER, name: "Name owner", role: "owner" },
      { userId: MEMBER, name: "Name member", role: "member" },
    ]);
    const after = await call(OWNER, "GET", `/api/teams/${teamId}/candidates`);
    expect(after.json.candidates).not.toContainEqual({ userId: MEMBER, name: "Name member" });

    const room = await call(MEMBER, "GET", `/api/discussions/${roomId}`);
    expect(room.status).toBe(200);
    expect(room.json.discussion.title).toBe("Launch");
    expect(room.json.owner).toEqual({ userId: OWNER, name: "Name owner" });
    const list = await call(MEMBER, "GET", "/api/discussions");
    expect(list.json.discussions.map((d: { id: string }) => d.id)).toEqual([roomId]);
    const messages = await call(MEMBER, "GET", `/api/conversations/${conversationId}/messages`);
    expect(messages.status).toBe(200);
    expect(messages.json.messages[0].content).toBe(
      "Room open for team Crew. Waiting for the first order.",
    );
    expect((await call(MEMBER, "GET", `/api/teams/${teamId}/people`)).status).toBe(200);
  });

  test("a member can read but not write, manage the team, or reach the owner's other chats", async () => {
    expect(
      (await call(MEMBER, "POST", `/api/discussions/${roomId}/messages`, { content: "hi" })).status,
    ).toBe(404);
    expect((await call(MEMBER, "POST", `/api/discussions/${roomId}/pause`)).status).toBe(404);
    expect(
      (await call(MEMBER, "POST", `/api/teams/${teamId}/people`, { userId: OUTSIDER })).status,
    ).toBe(404);
    expect((await call(MEMBER, "GET", `/api/teams/${teamId}/candidates`)).status).toBe(404);
    expect((await call(MEMBER, "GET", `/api/teams/${teamId}`)).status).toBe(404);
    expect(
      (
        await call(MEMBER, "POST", `/api/conversations/${conversationId}/messages`, {
          content: "hi",
        })
      ).status,
    ).toBe(404);
  });

  test("a person who is not in the team sees nothing of it", async () => {
    expect((await call(OUTSIDER, "GET", `/api/discussions/${roomId}`)).status).toBe(404);
    expect(
      (await call(OUTSIDER, "GET", `/api/conversations/${conversationId}/messages`)).status,
    ).toBe(404);
    expect((await call(OUTSIDER, "GET", `/api/teams/${teamId}/people`)).status).toBe(404);
    expect((await call(OUTSIDER, "GET", "/api/discussions")).json.discussions).toEqual([]);
  });

  test("the owner stays in the team, and removing a member closes the room to them", async () => {
    const own = await call(OWNER, "DELETE", `/api/teams/${teamId}/people/${OWNER}`);
    expect(own.status).toBe(400);
    const removed = await call(OWNER, "DELETE", `/api/teams/${teamId}/people/${MEMBER}`);
    expect(removed.status).toBe(200);
    expect(removed.json.people).toEqual([{ userId: OWNER, name: "Name owner", role: "owner" }]);
    expect((await call(MEMBER, "GET", `/api/discussions/${roomId}`)).status).toBe(404);
  });

  test("a removed installation member is denied, and enrolling again does not give the team back", async () => {
    await call(OWNER, "POST", `/api/teams/${teamId}/people`, { userId: MEMBER });
    expect((await call(MEMBER, "GET", `/api/discussions/${roomId}`)).status).toBe(200);

    const now = new Date();
    await db
      .update(membership)
      .set({ status: "removed", removedAt: now, updatedAt: now })
      .where(eq(membership.userId, MEMBER));
    expect((await call(MEMBER, "GET", `/api/discussions/${roomId}`)).status).toBe(403);
    expect((await call(OWNER, "GET", `/api/teams/${teamId}/people`)).json.people).toEqual([
      { userId: OWNER, name: "Name owner", role: "owner" },
    ]);
    expect(
      (await call(OWNER, "POST", `/api/teams/${teamId}/people`, { userId: MEMBER })).status,
    ).toBe(404);

    // The same step the enrollment code takes: active again under the next revision.
    await db
      .update(membership)
      .set({ status: "active", removedAt: null, activationRevision: 2, updatedAt: new Date() })
      .where(and(eq(membership.userId, MEMBER)));
    expect((await call(MEMBER, "GET", `/api/discussions/${roomId}`)).status).toBe(404);

    await call(OWNER, "POST", `/api/teams/${teamId}/people`, { userId: MEMBER });
    expect((await call(MEMBER, "GET", `/api/discussions/${roomId}`)).status).toBe(200);
  });
});

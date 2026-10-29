import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createLoopDriver, createLoopStore } from "../chat/loops";
import { createDiscussionStore } from "../discussions/store";
import { createDiscussionWorker } from "../discussions/worker";
import { createTeamStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `team-a-${uuidv7()}`;

suite("teams against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = async () => ({ isAdmin: false });
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    lookup,
  );
  /** Scripted replies per bot name; every run records who ran and its prompt. */
  const replies: Record<string, string[]> = {};
  const runs: { bot: string; prompt: string }[] = [];
  const reply = (t: { bot: { name: string }; prompt: string }) => {
    runs.push({ bot: t.bot.name, prompt: t.prompt });
    return replies[t.bot.name]?.shift() ?? "ok";
  };
  const fakeRun = Object.assign(async (t: never) => ({ text: reply(t), stopped: false }), {
    stream: async function* (t: never) {
      yield reply(t);
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
  const worker = createDiscussionWorker(db, discussions, chat, lookup);
  discussions.onEnqueue = worker.kick;
  // The same room-step runner as services.ts: wake the facilitator, then wait until the room is quiet.
  const driver = createLoopDriver(loops, async (loop, label) => {
    const room = (await discussions.byConversation(loop.conversationId))!;
    const started = await discussions.startLoopStep(room.id, label);
    if (started.state !== "started") return { status: "complete" };
    await discussions.settle(
      room.id,
      started.since,
      async () => (await loops.get(loop.id))?.status !== "running",
    );
    return { status: "complete" };
  });
  loops.onStart = driver.kick;
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    discussions: { access, store: discussions, worker },
    teams: { access, store: createTeamStore(db, discussions) },
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
  const makeBot = async (name: string) => {
    const b = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    await db.update(bot).set({ onboarded: true }).where(eq(bot.id, b.id));
    return b;
  };
  const at = { x: 10, y: 20 };

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
      .values({ userId: A, status: "active" as const, joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await worker.drain().catch(() => {});
    await cleanupTestUsers(db, [A]);
  });

  test("a team has exactly one chief and rejects stale saves", async () => {
    const lead = await makeBot("Lead"),
      coder = await makeBot("Coder");
    const t = (await call("POST", "/api/teams", { name: "Builders", goal: "Ship it" })).json.team;
    expect(t).toMatchObject({ name: "Builders", version: 1, members: [] });
    const body = (kinds: ["chief" | "member", "chief" | "member"]) => ({
      expectedVersion: 1,
      name: "Builders",
      goal: "Ship it",
      canvas: { x: 0, y: 0, w: 400, h: 300 },
      members: [
        { botId: lead.id, kind: kinds[0], role: "plans", canvas: at },
        { botId: coder.id, kind: kinds[1], role: "builds", canvas: at },
      ],
    });
    expect((await call("PUT", `/api/teams/${t.id}`, body(["chief", "chief"]))).status).toBe(400);
    expect((await call("PUT", `/api/teams/${t.id}`, body(["member", "member"]))).status).toBe(400);
    const saved = await call("PUT", `/api/teams/${t.id}`, body(["chief", "member"]));
    expect(saved.status).toBe(200);
    expect(saved.json.team.version).toBe(2);
    expect(
      saved.json.team.members
        .map((m: { name: string; kind: string }) => `${m.name}:${m.kind}`)
        .sort(),
    ).toEqual(["Coder:member", "Lead:chief"]);
    const stale = await call("PUT", `/api/teams/${t.id}`, body(["chief", "member"]));
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("STALE_VERSION");
  });

  test("a room wakes only the chief, the chief hands work on, and each turn keeps its steps", async () => {
    const lead = await makeBot("Chief Lead"),
      coder = await makeBot("Dev Coder");
    const t = (await call("POST", "/api/teams", { name: "Room team" })).json.team;
    await call("PUT", `/api/teams/${t.id}`, {
      expectedVersion: 1,
      name: "Room team",
      goal: "",
      canvas: { x: 0, y: 0, w: 400, h: 300 },
      members: [
        { botId: lead.id, kind: "chief", role: "plans", canvas: at },
        { botId: coder.id, kind: "member", role: "builds", canvas: at },
      ],
    });
    replies["Chief Lead"] = [
      "Splitting the work. @DevCoder please build the page",
      '```zetta:discussion\n{"action":"resolve","summary":"Page built"}\n```',
    ];
    replies["Dev Coder"] = ["Page built."];
    const room = await call("POST", `/api/teams/${t.id}/rooms`, {
      title: "Landing page",
      firstMessage: "Build a landing page",
    });
    expect(room.status).toBe(201);
    await worker.drain();
    expect(runs.map((r) => r.bot)).toEqual(["Chief Lead", "Dev Coder", "Chief Lead"]);
    expect(runs[0]!.prompt).toContain("You are the chief of this team");
    expect(runs[1]!.prompt).not.toContain("You are the chief of this team");
    const d = (await call("GET", `/api/discussions/${room.json.discussionId}`)).json;
    expect(d.discussion).toMatchObject({ teamId: t.id, status: "resolved", summary: "Page built" });
    const steps = (await call("GET", `/api/discussions/${room.json.discussionId}/steps`)).json;
    const first = steps.turns.at(-1);
    expect(first.status).toBe("done");
    expect(first.steps.at(-1)).toMatchObject({
      kind: "post",
      label: "Posted to the room",
      detail: "Splitting the work. @DevCoder please build the page",
    });
  });

  const teamOf = async (name: string, botNames: string[]) => {
    const made = await Promise.all(botNames.map((n) => makeBot(n)));
    const t = (await call("POST", "/api/teams", { name })).json.team;
    await call("PUT", `/api/teams/${t.id}`, {
      expectedVersion: 1,
      name,
      goal: "",
      canvas: { x: 0, y: 0, w: 400, h: 300 },
      members: made.map((b, i) => ({
        botId: b.id,
        kind: i === 0 ? "chief" : "member",
        role: "",
        canvas: at,
      })),
    });
    return t.id as string;
  };

  test("a team is read by id, and has no size limit", async () => {
    const id = await teamOf("Big team", ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]);
    const got = await call("GET", `/api/teams/${id}`);
    expect(got.status).toBe(200);
    expect(got.json.team).toMatchObject({ id, name: "Big team", version: 2 });
    expect(got.json.team.members).toHaveLength(8);
    expect((await call("GET", `/api/teams/${uuidv7()}`)).status).toBe(404);
  });

  test("room names are unique for the owner, whatever the case", async () => {
    const id = await teamOf("Naming team", ["N1", "N2"]);
    const first = await call("POST", `/api/teams/${id}/rooms`, {
      title: "Homepage",
      firstMessage: "Start",
    });
    expect(first.status).toBe(201);
    await worker.drain();
    const again = await call("POST", `/api/teams/${id}/rooms`, {
      title: "homepage",
      firstMessage: "Start again",
    });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("NAME_TAKEN");
  });

  test("a goal loop in a room makes the team discuss step after step until the chief reports done", async () => {
    const id = await teamOf("Loop team", ["Loop Lead", "Loop Dev"]);
    runs.length = 0;
    replies["Loop Lead"] = [
      "Opening the room.",
      "Let us start. @LoopDev build the header",
      'Header is in, nothing left to hand out.\n```zetta:goal_progress\n{"summary":"Header built"}\n```',
      "Next step: @LoopDev add the footer",
      'All parts are in.\n```zetta:goal_done\n{"summary":"Page finished"}\n```',
    ];
    replies["Loop Dev"] = ["Header built.", "Footer built."];
    const room = await call("POST", `/api/teams/${id}/rooms`, {
      title: "Loop page",
      firstMessage: "Hello",
    });
    await worker.drain();
    const loop = await call("POST", `/api/discussions/${room.json.discussionId}/loop`, {
      goal: "Build the page",
      doneWhen: "header and footer exist",
    });
    expect(loop.status).toBe(201);
    for (let i = 0; i < 60 && (await loops.get(loop.json.loop.id))?.status === "running"; i++)
      await Bun.sleep(500);
    await worker.drain();
    expect(await loops.get(loop.json.loop.id)).toMatchObject({
      status: "done",
      progress: "Page finished",
      iterations: 2,
    });
    expect(runs.slice(1).map((r) => r.bot)).toEqual([
      "Loop Lead",
      "Loop Dev",
      "Loop Lead",
      "Loop Lead",
      "Loop Dev",
      "Loop Lead",
    ]);
    expect(runs[1]!.prompt).toContain("The team is pursuing a goal");
  });
});

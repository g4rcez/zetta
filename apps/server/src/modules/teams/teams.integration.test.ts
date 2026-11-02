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
    const member = loop.botId !== room.createdByBotId ? loop.botId : undefined;
    const started = await discussions.startLoopStep(room.id, label, member);
    if (started.state !== "started") return { status: "complete" };
    await discussions.settle(
      room.id,
      started.since,
      async () => (await loops.get(loop.id))?.status !== "running",
      member,
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
        { botId: lead.id, kind: kinds[0], roleId: null, canvas: at },
        { botId: coder.id, kind: kinds[1], roleId: null, canvas: at },
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

  test("roles: a new user gets the suggested ones, edits them, and a member keeps its team when its role is deleted", async () => {
    const first = (await call("GET", "/api/team-roles")).json.roles as { name: string }[];
    expect(first.map((r) => r.name)).toEqual([
      "Researcher",
      "Developer",
      "Writer",
      "Reviewer",
      "Designer",
      "Analyst",
      "Tester",
      "Planner",
    ]);
    const made = await call("POST", "/api/team-roles", {
      name: "Release captain",
      description: "Owns the release",
      color: "red",
      icon: "shield",
    });
    expect(made.status).toBe(201);
    expect(made.json.role).toMatchObject({ name: "Release captain", color: "red", icon: "shield" });
    const dup = await call("POST", "/api/team-roles", { name: "release CAPTAIN" });
    expect(dup.status).toBe(409);
    expect((await call("POST", "/api/team-roles", { name: "x", color: "#ff0000" })).status).toBe(
      400,
    );
    const edited = await call("PUT", `/api/team-roles/${made.json.role.id}`, {
      name: "Release lead",
      description: "",
      color: "blue",
      icon: "compass",
    });
    expect(edited.json.role).toMatchObject({
      name: "Release lead",
      color: "blue",
      description: "",
    });

    const lead = await makeBot("Role Lead"),
      coder = await makeBot("Role Coder");
    const t = (await call("POST", "/api/teams", { name: "Role team" })).json.team;
    const saved = await call("PUT", `/api/teams/${t.id}`, {
      expectedVersion: 1,
      name: "Role team",
      goal: "",
      canvas: { x: 0, y: 0, w: 400, h: 300 },
      members: [
        { botId: lead.id, kind: "chief", roleId: null, canvas: at },
        { botId: coder.id, kind: "member", roleId: made.json.role.id, canvas: at },
      ],
    });
    expect(
      saved.json.team.members
        .map((m: { name: string; role: string }) => `${m.name}:${m.role}`)
        .sort(),
    ).toEqual(["Role Coder:Release lead", "Role Lead:"]);
    expect(
      (
        await call("PUT", `/api/teams/${t.id}`, {
          expectedVersion: 2,
          name: "Role team",
          goal: "",
          canvas: { x: 0, y: 0, w: 400, h: 300 },
          members: [{ botId: lead.id, kind: "chief", roleId: uuidv7(), canvas: at }],
        })
      ).status,
    ).toBe(404);

    expect((await call("DELETE", `/api/team-roles/${made.json.role.id}`)).status).toBe(200);
    const after = (await call("GET", `/api/teams/${t.id}`)).json.team.members as {
      name: string;
      roleId: string | null;
    }[];
    expect(after.find((m) => m.name === "Role Coder")).toMatchObject({ roleId: null });
    expect((await call("DELETE", `/api/team-roles/${made.json.role.id}`)).status).toBe(404);
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
        { botId: lead.id, kind: "chief", roleId: null, canvas: at },
        { botId: coder.id, kind: "member", roleId: null, canvas: at },
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
        roleId: null,
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

  test("a plain room moves into a team and back, and its bots then read the team context", async () => {
    const teamId = await teamOf("Move team", ["Move Lead", "Move Dev"]);
    const extra = await makeBot("Move Extra");
    const saved = (await call("GET", `/api/teams/${teamId}`)).json.team;
    const lead = saved.members.find((m: { kind: string }) => m.kind === "chief");
    const dev = saved.members.find((m: { kind: string }) => m.kind === "member");
    const plain = await call("POST", "/api/discussions", {
      title: "Move me",
      goal: "a goal",
      members: [{ bot: extra.id }, { bot: dev.botId }],
      firstMessage: "@MoveExtra hello",
    });
    expect(plain.status).toBe(201);
    await worker.drain();
    const roomId = plain.json.discussion.id as string;
    expect(plain.json.discussion).toMatchObject({ teamId: null, createdByBotId: null });

    const moved = await call("PUT", `/api/discussions/${roomId}/team`, { teamId });
    expect(moved.status).toBe(200);
    expect(moved.json.discussion).toMatchObject({ teamId, createdByBotId: lead.botId });
    const inTeam = await call("GET", `/api/discussions/${roomId}`);
    expect(inTeam.json.members.map((m: { name: string }) => m.name).sort()).toEqual([
      "Move Dev",
      "Move Extra",
      "Move Lead",
    ]);

    const withContext = await call("PUT", `/api/teams/${teamId}`, {
      expectedVersion: saved.version,
      name: "Move team",
      goal: "",
      context: "Stack: bun and postgres",
      canvas: saved.canvas,
      members: saved.members.map(
        (m: { botId: string; kind: string; roleId: null; canvas: unknown }) => ({
          botId: m.botId,
          kind: m.kind,
          roleId: m.roleId,
          canvas: m.canvas,
        }),
      ),
    });
    expect(withContext.json.team.context).toBe("Stack: bun and postgres");
    await call("POST", `/api/discussions/${roomId}/messages`, { content: "start the work" });
    await worker.drain();
    expect(runs.at(-1)!.prompt).toContain("Stack: bun and postgres");

    const out = await call("PUT", `/api/discussions/${roomId}/team`, { teamId: null });
    expect(out.json.discussion).toMatchObject({ teamId: null, createdByBotId: null });
    expect((await call("GET", `/api/discussions/${roomId}`)).json.members).toHaveLength(3);
  });

  test("a team save without a context keeps the context", async () => {
    const teamId = await teamOf("Keep team", ["Keep Lead", "Keep Dev"]);
    const t = (await call("GET", `/api/teams/${teamId}`)).json.team;
    const body = {
      name: "Keep team",
      goal: "",
      canvas: t.canvas,
      members: t.members.map(
        (m: { botId: string; kind: string; roleId: null; canvas: unknown }) => ({
          botId: m.botId,
          kind: m.kind,
          roleId: m.roleId,
          canvas: m.canvas,
        }),
      ),
    };
    const first = await call("PUT", `/api/teams/${teamId}`, {
      ...body,
      expectedVersion: t.version,
      context: "Shared rules",
    });
    const second = await call("PUT", `/api/teams/${teamId}`, {
      ...body,
      expectedVersion: first.json.team.version,
    });
    expect(second.json.team.context).toBe("Shared rules");
  });

  test("a room cannot move into a team that already has a room with that name", async () => {
    const teamId = await teamOf("Clash team", ["Clash Lead", "Clash Dev"]);
    const dev = (await call("GET", `/api/teams/${teamId}`)).json.team.members[1];
    await call("POST", `/api/teams/${teamId}/rooms`, { title: "Taken name" });
    const plain = await call("POST", "/api/discussions", {
      title: "taken NAME",
      goal: "",
      members: [{ bot: dev.botId }],
      firstMessage: "hello",
    });
    await worker.drain();
    const moved = await call("PUT", `/api/discussions/${plain.json.discussion.id}/team`, {
      teamId,
    });
    expect(moved.status).toBe(409);
    expect(moved.json.error.code).toBe("NAME_TAKEN");
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
    // The loop turns "done" while its last step is still being booked, so wait for the step count too.
    for (let i = 0; i < 60 && ((await loops.get(loop.json.loop.id))?.iterations ?? 0) < 2; i++)
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
    // The facilitator's loop instructions travel with the tool preamble, which fixture bots do not get; roomLoopPrompt is covered in loops.test.ts.
  });
  test("Chat with team opens one room without waking the chief, and reuses it", async () => {
    const id = await teamOf("Chat team", ["Chat Lead", "Chat Dev"]);
    runs.length = 0;
    const first = await call("POST", `/api/teams/${id}/chat`);
    expect(first.status).toBe(200);
    await worker.drain();
    expect(runs).toEqual([]);
    const again = await call("POST", `/api/teams/${id}/chat`);
    expect(again.json.discussionId).toBe(first.json.discussionId);
    expect(
      (await call("GET", `/api/discussions/${first.json.discussionId}`)).json.discussion,
    ).toMatchObject({
      title: "Chat team",
      status: "open",
    });
  });
  test("Chat with team after the room was cancelled reopens it under the team name, with no time suffix", async () => {
    const id = await teamOf("Cancel chat team", ["Cancel Lead", "Cancel Dev"]);
    const first = await call("POST", `/api/teams/${id}/chat`);
    await worker.drain();
    expect((await call("POST", `/api/discussions/${first.json.discussionId}/cancel`)).status).toBe(
      200,
    );
    const again = await call("POST", `/api/teams/${id}/chat`);
    expect(again.status).toBe(200);
    expect(again.json.discussionId).toBe(first.json.discussionId);
    expect(
      (await call("GET", `/api/discussions/${first.json.discussionId}`)).json.discussion,
    ).toMatchObject({ title: "Cancel chat team", status: "open" });
  });

  test("the chief splits a team goal, nothing runs until the user approves, then each member works on its own goal", async () => {
    const id = await teamOf("Goal team", ["Goal Lead", "Goal Writer", "Goal Dev"]);
    runs.length = 0;
    const room = (await call("POST", `/api/teams/${id}/chat`)).json.discussionId as string;
    const conversationId = (await call("GET", `/api/discussions/${room}`)).json.discussion
      .conversationId as string;
    replies["Goal Lead"] = [
      'Splitting the goal.\n```zetta:team_goals\n{"goals":[{"bot":"GoalWriter","goal":"Write the FAQ","done_when":"the FAQ exists"}]}\n```',
    ];
    replies["Goal Writer"] = [
      'Draft started.\n```zetta:goal_progress\n{"summary":"Draft started"}\n```',
      'FAQ ready.\n```zetta:goal_done\n{"summary":"FAQ written"}\n```',
    ];
    await call("POST", `/api/discussions/${room}/messages`, { content: "Ship the help center" });
    await worker.drain();
    const proposal = (await call("GET", "/api/proposals")).json.proposals.find(
      (p: { kind: string; patch: { discussionId?: string } }) =>
        p.kind === "team_goals" && p.patch.discussionId === room,
    );
    expect(proposal.diff).toEqual([{ field: "Goal Writer", from: null, to: "Write the FAQ" }]);
    expect(await loops.activeAll(conversationId)).toEqual([]);
    expect(runs.map((r) => r.bot)).toEqual(["Goal Lead"]);

    const decided = await call("POST", `/api/proposals/${proposal.id}/decision`, { approve: true });
    expect(decided.json).toMatchObject({ status: "approved" });
    const [loop] = await loops.activeAll(conversationId);
    expect(loop).toMatchObject({ goal: "Write the FAQ", doneWhen: "the FAQ exists" });
    for (let i = 0; i < 60 && (await loops.get(loop!.id))?.status !== "done"; i++)
      await Bun.sleep(500);
    await worker.drain();
    expect(await loops.get(loop!.id)).toMatchObject({ status: "done", progress: "FAQ written" });
    // The progress report did not wake the chief; the finished goal did.
    expect(runs.map((r) => r.bot)).toEqual([
      "Goal Lead",
      "Goal Writer",
      "Goal Writer",
      "Goal Lead",
    ]);
  });

  test("two members can each have an active loop in one room, but a member cannot have two", async () => {
    const id = await teamOf("Index team", ["Index Lead", "Index A", "Index B"]);
    const room = (await call("POST", `/api/teams/${id}/chat`)).json.discussionId as string;
    const d = (await call("GET", `/api/discussions/${room}`)).json;
    const [a, b] = d.members.filter((m: { name: string }) => m.name !== "Index Lead");
    const start = (botId: string) =>
      loops.start(A, {
        conversationId: d.discussion.conversationId,
        botId,
        goal: "g",
        doneWhen: "d",
      });
    loops.onStart = undefined;
    await start(a.botId);
    await start(b.botId);
    expect(start(a.botId)).rejects.toThrow();
    loops.onStart = driver.kick;
    for (const l of await loops.activeAll(d.discussion.conversationId))
      await loops.end(l.id, "cancelled", "test over");
  });
});

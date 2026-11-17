import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation } from "@zetta/db/schema/chat";
import { discussion, discussionMember } from "@zetta/db/schema/discussions";
import { decisionConfig, workflow } from "@zetta/db/schema/features";
import { installationIdentity, membership } from "@zetta/db/schema/identity";
import { team, teamMember, teamRole } from "@zetta/db/schema/teams";
import { createApp } from "../../app";
import { cleanupTestUsers, resetOrgChart } from "../../test-support/db-cleanup";
import { createChief } from "../chat/chief";
import { isChiefWrite } from "../chat/chief/kinds";
import { createIdentityAccess } from "../identity/access";
import type { OrgDraft } from "./draft";
import type { OrgLink } from "./links";
import { createOrgStore, type OrgView } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`org-d-${uuidv7()}`, `org-e-${uuidv7()}`];
const [ADMIN, B] = ids as [string, string];

suite("draw the chart from the teams, and which bots work together, against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const org = createOrgStore(db);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async (userId) => ({ isAdmin: userId === ADMIN }),
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    org: { access, org },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const res = await app.handle(
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
    const json = (await res.json()) as {
      org?: OrgView;
      draft?: OrgDraft;
      links?: OrgLink[];
      error?: { code: string };
    };
    return { status: res.status, ...json };
  };

  const newBot = async (ownerUserId: string, name: string, over: object = {}) =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId,
          name,
          slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "team",
          harness: "fixture",
          ...over,
        } as never)
        .returning()
    )[0]!.id;
  const newTeam = async (name: string, owner = ADMIN, status: "active" | "archived" = "active") =>
    (
      await db
        .insert(team)
        .values({ ownerUserId: owner, name, goal: `Goal of ${name}\nsecond line`, status })
        .returning()
    )[0]!.id;
  const join = (teamId: string, botId: string, kind: "chief" | "member", roleId?: string) =>
    db.insert(teamMember).values({ teamId, botId, kind, roleId: roleId ?? null });
  const room = async (
    owner: string,
    members: string[],
    over: { status?: "open" | "paused" | "resolved"; updatedAt?: Date } = {},
  ) => {
    const [conv] = await db
      .insert(conversation)
      .values({ ownerUserId: owner, botId: members[0]!, kind: "discussion", title: "Room" })
      .returning();
    const [d] = await db
      .insert(discussion)
      .values({
        ownerUserId: owner,
        conversationId: conv!.id,
        title: `Room ${uuidv7().slice(-6)}`,
        openKey: uuidv7(),
        ...over,
      })
      .returning();
    await db
      .insert(discussionMember)
      .values(members.map((m) => ({ discussionId: d!.id, botId: m })));
  };

  let alpha = "",
    beta = "",
    lead = "",
    dev = "",
    qa = "",
    hidden = "",
    personal = "",
    soloChief = "",
    loner = "",
    old = "";

  beforeAll(async () => {
    await resetOrgChart(db);
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: `Name ${id.slice(4, 9)}`,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    await db
      .insert(installationIdentity)
      .values({ id: 1, adminUserId: ADMIN, bootstrappedAt: now })
      .onConflictDoUpdate({ target: installationIdentity.id, set: { adminUserId: ADMIN } });
    lead = await newBot(ADMIN, "Lead");
    dev = await newBot(ADMIN, "Dev");
    qa = await newBot(ADMIN, "Qa");
    hidden = await newBot(ADMIN, "Hidden", { visibility: "private" });
    personal = await newBot(ADMIN, "Zeta", { kind: "chief", visibility: "private" });
    soloChief = await newBot(ADMIN, "Solo");
    loner = await newBot(ADMIN, "Loner");
    old = await newBot(ADMIN, "Old");
    const [role] = await db
      .insert(teamRole)
      .values({ ownerUserId: ADMIN, name: "Developer" })
      .returning();
    alpha = await newTeam(`Alpha ${ADMIN}`);
    beta = await newTeam(`Beta ${ADMIN}`);
    await newTeam(`Gone ${ADMIN}`, ADMIN, "archived");
    await newTeam(`Theirs ${B}`, B);
    await join(alpha, lead, "chief");
    await join(alpha, dev, "member", role!.id);
    await join(alpha, qa, "member");
    await join(alpha, hidden, "member");
    await join(alpha, personal, "member");
    await join(beta, soloChief, "chief");
    // Dev is also in Beta: a bot holds one seat in the draft, in the first team that has it.
    await join(beta, dev, "member");
  });
  afterAll(async () => {
    await resetOrgChart(db);
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    await cleanupTestUsers(db, ids);
  });

  test("the draft is a preview: teams become leader seats, bots get seats, and nothing is saved", async () => {
    const r = await call(ADMIN, "GET", "/api/org/draft");
    expect(r.status).toBe(200);
    const seats = r.draft!.seats;
    expect(seats[0]).toMatchObject({ rank: "ceo", parentRef: null, holder: null });
    const leads = seats.filter((s) => s.rank === "lead");
    // The archived team and the other person's team are not drawn.
    expect(leads.map((s) => s.team?.name)).toEqual([`Alpha ${ADMIN}`, `Beta ${ADMIN}`]);
    const alphaLead = leads[0]!;
    expect(alphaLead).toMatchObject({
      parentRef: 0,
      title: `Alpha ${ADMIN} lead`,
      description: `Goal of Alpha ${ADMIN}`,
      holder: { botId: lead, name: "Lead" },
    });
    expect(leads[1]!.holder).toMatchObject({ botId: soloChief });
    const under = seats.filter((s) => s.parentRef === alphaLead.ref);
    // The role of the team (Developer) names the seat; without one, the bot's name does.
    expect(under.map((s) => [s.title, s.holder?.botId])).toEqual([
      ["Developer", dev],
      ["Qa", qa],
    ]);
    expect(r.draft!.skipped.map((s) => [s.name, s.reason]).sort()).toEqual(
      [
        ["Dev", "already_seated"],
        ["Hidden", "private"],
        ["Zeta", "chief_of_staff"],
      ].sort(),
    );
    const view = (await call(ADMIN, "GET", "/api/org")).org!;
    expect(view.positions).toEqual([]);
    expect(view.chart.version).toBe(0);
  });

  test("only the admin reads or applies the draft", async () => {
    expect((await call(B, "GET", "/api/org/draft")).status).toBe(403);
    expect((await call(B, "POST", "/api/org/draft", { expectedVersion: 0 })).status).toBe(403);
  });

  test("the admin can leave a team or a bot out of the preview", async () => {
    const r = await call(
      ADMIN,
      "GET",
      `/api/org/draft?skipTeamIds=${beta}&skipBotIds=${qa},${lead}`,
    );
    const seats = r.draft!.seats;
    expect(seats.filter((s) => s.rank === "lead").map((s) => s.team?.id)).toEqual([alpha]);
    // A leader left out leaves the seat open; a member left out leaves no seat.
    expect(seats.find((s) => s.rank === "lead")!.holder).toBeNull();
    expect(seats.some((s) => s.holder?.botId === qa)).toBe(false);
    expect(seats.some((s) => s.holder?.botId === dev)).toBe(true);
    expect((await call(ADMIN, "GET", "/api/org/draft?skipTeamIds=not-an-id")).status).toBe(400);
  });

  test("confirming saves the whole draft at once into an empty chart", async () => {
    const stale = await call(ADMIN, "POST", "/api/org/draft", { expectedVersion: 5 });
    expect(stale.status).toBe(409);
    const r = await call(ADMIN, "POST", "/api/org/draft", {
      expectedVersion: 0,
      skipBotIds: [],
    });
    expect(r.status).toBe(201);
    const view = r.org!;
    expect(view.chart.version).toBeGreaterThan(0);
    const ceo = view.positions.find((p) => p.rank === "ceo")!;
    const alphaSeat = view.positions.find((p) => p.team?.id === alpha)!;
    expect(alphaSeat).toMatchObject({ parentId: ceo.id, seat: "bot", rank: "lead" });
    expect(alphaSeat.holder).toMatchObject({ kind: "bot", botId: lead });
    const kids = view.positions.filter((p) => p.parentId === alphaSeat.id);
    expect(kids.map((p) => p.title)).toEqual(["Developer", "Qa"]);
    expect(kids.every((p) => p.seat === "bot")).toBe(true);
    expect(view.positions).toHaveLength(1 + 2 + 2);
    // A chart that exists is not replaced.
    const again = await call(ADMIN, "POST", "/api/org/draft", {
      expectedVersion: view.chart.version,
    });
    expect(again.status).toBe(400);
  });

  test("works-with pairs come from shared rooms, workflow order and decision handoffs, and only for seated bots", async () => {
    // Lead and Dev share two live rooms and a workflow (Lead, a condition, then Dev); Dev hands over to Qa.
    await room(ADMIN, [lead, dev]);
    await room(ADMIN, [lead, dev, qa, loner], { status: "paused" });
    // A room that was closed long ago does not count, nor does a room that another person owns.
    await room(ADMIN, [lead, old], {
      status: "resolved",
      updatedAt: new Date(Date.now() - 200 * 86_400_000),
    });
    await room(B, [dev, qa]);
    await db.insert(workflow).values({
      ownerUserId: ADMIN,
      name: "Review",
      graph: {
        start: "a",
        nodes: {
          a: { type: "prompt", botId: lead, template: "draft", next: "c" },
          // oxlint-disable-next-line unicorn/no-thenable
          c: { type: "condition", contains: "ok", then: "b", else: "e" },
          b: { type: "prompt", botId: dev, template: "build", next: "e" },
          e: { type: "end" },
        },
      },
    });
    await db.insert(decisionConfig).values({
      botId: dev,
      ownerUserId: ADMIN,
      enabled: true,
      question: "Who takes it?",
      options: [
        { label: "QA", description: "test it", action: "delegate", targetBotId: qa },
        { label: "QA again", description: "retest", action: "delegate", targetBotId: qa },
        { label: "Me", description: "mine", action: "respond", reply: "ok" },
      ],
    });
    const r = await call(ADMIN, "GET", "/api/org/links");
    expect(r.status).toBe(200);
    const pair = (a: string, b: string) =>
      r.links!.find((l) => [l.aId, l.bId].sort().join() === [a, b].sort().join());
    expect(pair(lead, dev)).toMatchObject({
      weight: 3,
      kinds: ["room", "workflow"],
      counts: { room: 2, workflow: 1, handoff: 0 },
    });
    expect(pair(dev, qa)).toMatchObject({
      weight: 2,
      kinds: ["room", "handoff"],
      counts: { room: 1, workflow: 0, handoff: 1 },
    });
    expect(pair(lead, qa)).toMatchObject({ weight: 1, kinds: ["room"] });
    // Not in the chart, or only in a closed room: no line.
    expect(r.links!.some((l) => [l.aId, l.bId].includes(loner))).toBe(false);
    expect(r.links!.some((l) => [l.aId, l.bId].includes(old))).toBe(false);
    // The strongest pair comes first, and a pair has one shape (aId sorts before bId).
    expect(r.links![0]!.weight).toBe(3);
    expect(r.links!.every((l) => l.aId < l.bId)).toBe(true);
    // Another person reads their own rooms only: B owns one room, so one pair at most.
    const mine = await call(B, "GET", "/api/org/links");
    expect(mine.status).toBe(200);
    expect(mine.links).toEqual([
      expect.objectContaining({
        weight: 1,
        kinds: ["room"],
        counts: { room: 1, workflow: 0, handoff: 0 },
      }),
    ]);
  });

  test("the chief reads the pairs by name, and reading them is not a change that waits for approval", async () => {
    const chief = createChief({ db, chat: {} as never, org });
    const who = { id: personal, name: "Zeta", kind: "chief", ownerUserId: ADMIN } as never;
    const out = await chief.run({ userId: ADMIN, isAdmin: true } as never, who, "org", {
      action: "works_with",
    });
    const text = "read" in out ? out.read : "";
    expect(text).toContain("org.works_with");
    expect(text).toContain("Dev");
    expect(text).toContain('"workflows":1');
    expect(isChiefWrite({ kind: "org", args: { action: "works_with" } })).toBe(false);
  });
});

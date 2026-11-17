import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { installationIdentity, membership } from "@zetta/db/schema/identity";
import { userPreference } from "@zetta/db/schema/preferences";
import { team } from "@zetta/db/schema/teams";
import { createApp } from "../../app";
import { cleanupTestUsers, resetOrgChart } from "../../test-support/db-cleanup";
import { isChiefWrite } from "../chat/chief/kinds";
import { createChief } from "../chat/chief";
import { ORG_BOT_TOOLS } from "../chat/chief/prompt";
import { createTurnRunner } from "../chat/pipeline";
import { parseTools } from "../chat/tools";
import { createIdentityAccess } from "../identity/access";
import { orgContextFor, teamLeadLine } from "./context";
import { ORG_MAX_POSITIONS, createOrgStore, readOrg, type OrgView } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
// 0 admin, 1 member, 2 member who leaves, 3 not a member
const ids = [`org-a-${uuidv7()}`, `org-b-${uuidv7()}`, `org-c-${uuidv7()}`, `org-d-${uuidv7()}`];
const [ADMIN, B, C, D] = ids as [string, string, string, string];

suite("company chart against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const org = createOrgStore(db);
  const told: string[][] = [];
  org.onChange = (userIds) => void told.push(userIds);
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
  type Reply = { org: OrgView; error?: { code: string; message: string } };
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
    const json = (await res.json()) as Reply;
    return { status: res.status, ...json };
  };
  const get = async (as = ADMIN) => (await call(as, "GET", "/api/org")).org;
  /** The admin's writes always carry the version the admin last saw. */
  const write = async (method: string, path: string, body: object = {}) => {
    const v = (await get()).chart.version;
    const sep = method === "DELETE" ? `?expectedVersion=${v}` : "";
    return call(
      ADMIN,
      method,
      path + sep,
      method === "DELETE" ? undefined : { expectedVersion: v, ...body },
    );
  };
  const seatOf = (view: OrgView, title: string) => view.positions.find((p) => p.title === title)!;
  const addSeat = async (parentId: string | null, templateKey: string, over: object = {}) => {
    const r = await write("POST", "/api/org/positions", { parentId, templateKey, ...over });
    expect(r.status).toBe(201);
    return r.org;
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
  const wipe = () => resetOrgChart(db);

  let teamBot = "",
    otherTeamBot = "",
    privateBot = "",
    chiefBot = "",
    adminTeam = "",
    otherTeam = "";

  beforeAll(async () => {
    await wipe();
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
    await db.insert(membership).values(
      [ADMIN, B, C].map((userId) => ({
        userId,
        status: "active" as const,
        joinedAt: now,
        updatedAt: now,
      })),
    );
    // The first user is the administrator of this throwaway installation (the turn pipeline reads it from the database).
    await db
      .insert(installationIdentity)
      .values({ id: 1, adminUserId: ADMIN, bootstrappedAt: now })
      .onConflictDoUpdate({ target: installationIdentity.id, set: { adminUserId: ADMIN } });
    teamBot = await newBot(B, "Scribe");
    otherTeamBot = await newBot(B, "Painter");
    privateBot = await newBot(B, "Hidden", { visibility: "private" });
    chiefBot = await newBot(ADMIN, "Zeta", { kind: "chief", visibility: "private" });
    adminTeam = (
      await db
        .insert(team)
        .values({ ownerUserId: ADMIN, name: `Crew ${ADMIN}` })
        .returning()
    )[0]!.id;
    otherTeam = (
      await db
        .insert(team)
        .values({ ownerUserId: B, name: `Crew ${B}` })
        .returning()
    )[0]!.id;
  });
  afterAll(async () => {
    await wipe();
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    await cleanupTestUsers(db, ids);
    await db.delete(user).where(eq(user.id, D));
  });

  test("before any edit the chart is empty at version 0, and only the admin can edit and gets the palette", async () => {
    const admin = await get();
    expect(admin).toMatchObject({ canEdit: true, chart: { id: null, version: 0 }, positions: [] });
    expect(admin.palette!.people.map((p) => p.userId).sort()).toEqual([ADMIN, B, C].sort());
    const botNames = admin.palette!.bots.map((b) => b.name);
    expect(botNames).toContain("Scribe");
    expect(botNames).not.toContain("Hidden");
    expect(botNames).not.toContain("Zeta");
    expect(admin.palette!.teams.map((t) => t.id)).toEqual([adminTeam]);
    expect(await get(B)).toMatchObject({ canEdit: false, palette: null });
  });

  test("a member who is not the admin cannot change the chart", async () => {
    const r = await call(B, "POST", "/api/org/positions", {
      expectedVersion: 0,
      templateKey: "ceo",
    });
    expect(r.status).toBe(403);
    expect(r.error!.message).toBe("Only the admin changes the chart.");
    expect((await get()).positions).toEqual([]);
  });

  test("the first seat is the CEO, and the first edit starts from version 0", async () => {
    const wrong = await write("POST", "/api/org/positions", { templateKey: "cto" });
    expect(wrong.status).toBe(400);
    expect(wrong.error!.message).toBe("Start the chart with the CEO.");
    const view = await addSeat(null, "ceo");
    expect(view.positions).toHaveLength(1);
    expect(view.positions[0]).toMatchObject({
      rank: "ceo",
      parentId: null,
      title: "CEO",
      seat: "open",
      templateKey: "ceo",
    });
    expect(view.chart.version).toBe(2);
    expect(told.at(-1)!.sort()).toEqual([ADMIN, B, C].sort());
  });

  test("an edit made on an old version is refused with a plain message", async () => {
    const r = await call(ADMIN, "POST", "/api/org/positions", {
      expectedVersion: 1,
      parentId: (await get()).positions[0]!.id,
      templateKey: "cto",
    });
    expect(r.status).toBe(409);
    expect(r.error).toMatchObject({ code: "STALE_VERSION" });
    expect((await get()).positions).toHaveLength(1);
  });

  test("seats come from templates, with their own words, and keep the order they were added in", async () => {
    const ceo = seatOf(await get(), "CEO");
    await addSeat(ceo.id, "cto");
    await addSeat(ceo.id, "cfo");
    const view = await addSeat(ceo.id, "executive-assistant", { title: "Chief of staff" });
    const kids = view.positions.filter((p) => p.parentId === ceo.id);
    expect(kids.map((p) => p.title)).toEqual(["CTO", "CFO", "Chief of staff"]);
    expect(seatOf(view, "CTO")).toMatchObject({ rank: "executive", unit: "Engineering" });
    expect(seatOf(view, "Chief of staff").templateKey).toBe("executive-assistant");
    expect(seatOf(view, "CTO").description.length).toBeGreaterThan(20);
  });

  test("a second CEO, a seat with no manager and an unknown template are refused", async () => {
    const ceo = seatOf(await get(), "CEO");
    const two = await write("POST", "/api/org/positions", { parentId: ceo.id, templateKey: "ceo" });
    expect(two.error!.message).toBe("There can be only one CEO.");
    const none = await write("POST", "/api/org/positions", { templateKey: "cto" });
    expect(none.error!.message).toBe("Pick the seat this one reports to.");
    const gone = await write("POST", "/api/org/positions", {
      parentId: uuidv7(),
      templateKey: "cto",
    });
    expect(gone.status).toBe(404);
    const unknown = await write("POST", "/api/org/positions", {
      parentId: ceo.id,
      templateKey: "nope",
    });
    expect(unknown.error!.message).toBe("That role template does not exist.");
    const blank = await write("POST", "/api/org/positions", { parentId: ceo.id, title: " " });
    expect(blank.status).toBe(400);
    expect((await get()).positions).toHaveLength(4);
  });

  test("a person or a team bot holds a seat; a private bot, a chief and a stranger do not", async () => {
    const cto = seatOf(await get(), "CTO");
    const person = await write("PUT", `/api/org/positions/${cto.id}/seat`, {
      holder: { kind: "person", userId: B },
    });
    expect(person.status).toBe(200);
    expect(seatOf(person.org, "CTO")).toMatchObject({
      seat: "person",
      holder: { kind: "person", userId: B },
    });
    // What the holder wrote about themselves goes with the seat, and the palette shows their title as the rest of the app does.
    await db
      .insert(userPreference)
      .values({ ownerUserId: B, jobTitle: "Head of tech" })
      .onConflictDoUpdate({
        target: userPreference.ownerUserId,
        set: { jobTitle: "Head of tech" },
      });
    expect(seatOf(await get(), "CTO").holder).toMatchObject({
      kind: "person",
      jobTitle: "Head of tech",
    });
    expect(
      (await get()).palette!.people.find((p: { userId: string }) => p.userId === B),
    ).toMatchObject({
      title: "Head of tech",
    });
    await db.update(userPreference).set({ jobTitle: "" }).where(eq(userPreference.ownerUserId, B));

    const cfo = seatOf(await get(), "CFO");
    const botSeat = await write("PUT", `/api/org/positions/${cfo.id}/seat`, {
      holder: { kind: "bot", botId: teamBot },
    });
    expect(seatOf(botSeat.org, "CFO")).toMatchObject({
      seat: "bot",
      holder: { kind: "bot", botId: teamBot, name: "Scribe" },
    });

    const priv = await write("PUT", `/api/org/positions/${cfo.id}/seat`, {
      holder: { kind: "bot", botId: privateBot },
    });
    expect(priv.error!.message).toBe(
      "A private bot cannot hold a seat. Share it with the team first.",
    );
    const chief = await write("PUT", `/api/org/positions/${cfo.id}/seat`, {
      holder: { kind: "bot", botId: chiefBot },
    });
    expect(chief.error!.message).toBe("A personal chief of staff cannot hold a seat.");
    const stranger = await write("PUT", `/api/org/positions/${cfo.id}/seat`, {
      holder: { kind: "person", userId: D },
    });
    expect(stranger.error!.message).toBe("That person is not a member any more.");
    expect(seatOf(await get(), "CFO").holder).toMatchObject({ botId: teamBot });
  });

  test("one person can hold two seats, and a seat can be emptied", async () => {
    const view = await get();
    const aide = seatOf(view, "Chief of staff");
    const held = await write("PUT", `/api/org/positions/${aide.id}/seat`, {
      holder: { kind: "person", userId: B },
    });
    expect(
      held.org.positions.filter((p) => p.holder?.kind === "person" && p.holder.userId === B),
    ).toHaveLength(2);
    const emptied = await write("PUT", `/api/org/positions/${aide.id}/seat`, {
      holder: { kind: "open" },
    });
    expect(seatOf(emptied.org, "Chief of staff")).toMatchObject({ seat: "open", holder: null });
  });

  test("a seat reports to another seat; loops, the CEO and deep chains are refused", async () => {
    const view = await addSeat(seatOf(await get(), "CTO").id, "tech-lead");
    const ceo = seatOf(view, "CEO");
    const cto = seatOf(view, "CTO");
    const lead = seatOf(view, "Tech lead");
    const loop = await write("POST", `/api/org/positions/${cto.id}/move`, { parentId: lead.id });
    expect(loop.error!.message).toBe("A seat cannot report to one of its own reports.");
    const self = await write("POST", `/api/org/positions/${cto.id}/move`, { parentId: cto.id });
    expect(self.error!.message).toBe("A seat cannot report to itself.");
    const top = await write("POST", `/api/org/positions/${ceo.id}/move`, { parentId: cto.id });
    expect(top.error!.message).toBe(
      "The CEO is the top of the chart and does not report to anyone.",
    );
    const away = await write("POST", `/api/org/positions/${lead.id}/move`, {
      parentId: seatOf(view, "CFO").id,
    });
    expect(away.status).toBe(200);
    expect(seatOf(away.org, "Tech lead").parentId).toBe(seatOf(view, "CFO").id);
  });

  test("a seat can move to another place among its siblings", async () => {
    const ceo = seatOf(await get(), "CEO");
    const aide = seatOf(await get(), "Chief of staff");
    const first = await write("POST", `/api/org/positions/${aide.id}/move`, {
      parentId: ceo.id,
      index: 0,
    });
    expect(first.org.positions.filter((p) => p.parentId === ceo.id).map((p) => p.title)).toEqual([
      "Chief of staff",
      "CTO",
      "CFO",
    ]);
    const last = await write("POST", `/api/org/positions/${aide.id}/move`, { parentId: ceo.id });
    expect(last.org.positions.filter((p) => p.parentId === ceo.id).map((p) => p.title)).toEqual([
      "CTO",
      "CFO",
      "Chief of staff",
    ]);
  });

  test("the words of a seat change, but the CEO stays the CEO and rank ceo is taken", async () => {
    const view = await get();
    const cto = seatOf(view, "CTO");
    const ceo = seatOf(view, "CEO");
    const ok = await write("PATCH", `/api/org/positions/${cto.id}`, {
      title: "Head of technology",
      unit: "Tech",
      rank: "lead",
      description: "Runs the tech.",
    });
    expect(seatOf(ok.org, "Head of technology")).toMatchObject({
      rank: "lead",
      unit: "Tech",
      description: "Runs the tech.",
    });
    const demote = await write("PATCH", `/api/org/positions/${ceo.id}`, { rank: "executive" });
    expect(demote.error!.message).toBe("The CEO seat stays the CEO.");
    const second = await write("PATCH", `/api/org/positions/${cto.id}`, { rank: "ceo" });
    expect(second.error!.message).toBe("There can be only one CEO.");
    const blank = await write("PATCH", `/api/org/positions/${cto.id}`, { title: "  " });
    expect(blank.status).toBe(400);
  });

  test("a seat links the team its admin owns, and no other", async () => {
    const lead = seatOf(await get(), "Head of technology");
    const own = await write("PATCH", `/api/org/positions/${lead.id}`, { teamId: adminTeam });
    expect(seatOf(own.org, "Head of technology").team).toEqual({
      id: adminTeam,
      name: `Crew ${ADMIN}`,
    });
    const foreign = await write("PATCH", `/api/org/positions/${lead.id}`, { teamId: otherTeam });
    expect(foreign.error!.message).toBe("You can link only teams that you own.");
    await db.update(team).set({ status: "archived" }).where(eq(team.id, adminTeam));
    expect(seatOf(await get(), "Head of technology").team).toBeNull();
    await db.update(team).set({ status: "active" }).where(eq(team.id, adminTeam));
    const off = await write("PATCH", `/api/org/positions/${lead.id}`, { teamId: null });
    expect(seatOf(off.org, "Head of technology").team).toBeNull();
  });

  test("someone who left, and a bot that is private again, read as an open seat with a note", async () => {
    const view = await get();
    const cto = seatOf(view, "Head of technology");
    const aide = seatOf(view, "Chief of staff");
    await write("PUT", `/api/org/positions/${cto.id}/seat`, {
      holder: { kind: "person", userId: C },
    });
    await write("PUT", `/api/org/positions/${aide.id}/seat`, {
      holder: { kind: "bot", botId: otherTeamBot },
    });
    await db
      .update(membership)
      .set({ status: "removed", removedAt: new Date() })
      .where(eq(membership.userId, C));
    await db.update(bot).set({ visibility: "private" }).where(eq(bot.id, otherTeamBot));

    const asAdmin = await get();
    expect(seatOf(asAdmin, "Head of technology")).toMatchObject({
      seat: "open",
      holder: null,
      problem: { code: "member_removed", mine: false },
    });
    expect(seatOf(asAdmin, "Chief of staff").problem).toMatchObject({
      code: "bot_private",
      was: "Painter",
      mine: false,
    });
    // The owner of the bot is the one who sees "mine".
    expect(seatOf(await get(B), "Chief of staff").problem).toMatchObject({
      code: "bot_private",
      mine: true,
    });

    await db
      .update(bot)
      .set({ visibility: "team", archived: true })
      .where(eq(bot.id, otherTeamBot));
    expect(seatOf(await get(), "Chief of staff").problem?.code).toBe("bot_archived");
    await db.update(bot).set({ archived: false }).where(eq(bot.id, otherTeamBot));
    expect(seatOf(await get(), "Chief of staff")).toMatchObject({ seat: "bot", problem: null });
  });

  test("removing a seat moves its reports up to its manager, in its place", async () => {
    const view = await get();
    const cfo = seatOf(view, "CFO");
    const ceo = seatOf(view, "CEO");
    const lead = seatOf(view, "Tech lead");
    expect(lead.parentId).toBe(cfo.id);
    const gone = await write("DELETE", `/api/org/positions/${cfo.id}`);
    expect(gone.status).toBe(200);
    expect(gone.org.positions.find((p) => p.id === cfo.id)).toBeUndefined();
    const kids = gone.org.positions.filter((p) => p.parentId === ceo.id);
    expect(kids.map((p) => p.title)).toEqual(["Head of technology", "Tech lead", "Chief of staff"]);
    expect(kids.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  test("the CEO cannot be removed while somebody reports to it", async () => {
    const ceo = seatOf(await get(), "CEO");
    const r = await write("DELETE", `/api/org/positions/${ceo.id}`);
    expect(r.status).toBe(400);
    expect(r.error!.message).toBe("Move or remove the seats under the CEO first.");
  });

  test("a company template needs an empty chart; a team template hangs under a seat", async () => {
    const view = await get();
    const company = await write("POST", "/api/org/presets", { presetKey: "small-startup" });
    expect(company.error!.message).toBe(
      "A whole company template needs an empty chart. Add a team under a seat instead.",
    );
    const noSeat = await write("POST", "/api/org/presets", { presetKey: "support-desk" });
    expect(noSeat.error!.message).toBe("Pick the seat this team reports to.");
    const before = view.positions.length;
    const under = seatOf(view, "Chief of staff");
    const desk = await write("POST", "/api/org/presets", {
      presetKey: "support-desk",
      underPositionId: under.id,
    });
    expect(desk.status).toBe(201);
    expect(desk.org.positions).toHaveLength(before + 5);
    const lead = desk.org.positions.find((p) => p.title === "Customer support lead")!;
    expect(lead.parentId).toBe(under.id);
    expect(desk.org.positions.filter((p) => p.parentId === lead.id)).toHaveLength(4);
    const missing = await write("POST", "/api/org/presets", { presetKey: "nope" });
    expect(missing.status).toBe(404);
  });

  test("on an empty chart a company template builds the whole company", async () => {
    await wipe();
    expect((await get()).chart.version).toBe(0);
    const r = await write("POST", "/api/org/presets", { presetKey: "solo-founder" });
    expect(r.status).toBe(201);
    expect(r.org.positions).toHaveLength(6);
    expect(r.org.positions.filter((p) => p.parentId === null)).toHaveLength(1);
    expect(seatOf(r.org, "CEO").rank).toBe("ceo");
  });

  test("a team template on an empty chart gets an open CEO above it", async () => {
    await wipe();
    const r = await write("POST", "/api/org/presets", { presetKey: "product-team" });
    expect(r.status).toBe(201);
    const root = r.org.positions.find((p) => p.parentId === null)!;
    expect(root).toMatchObject({ rank: "ceo", seat: "open" });
    expect(seatOf(r.org, "Head of engineering").parentId).toBe(root.id);
  });

  test("a seated bot reads its place in the company at the start of its turn; the chief reads the top; outside people read nothing", async () => {
    // The chart is the product team under an open CEO. The turn bot is a real engine bot (a fixture bot reads no extras).
    const turnBot = await newBot(B, "Turner", { harness: "claude-code" });
    const lead = seatOf(await get(), "Head of engineering");
    const seated = await write("PUT", `/api/org/positions/${lead.id}/seat`, {
      holder: { kind: "bot", botId: turnBot },
    });
    expect(seated.status).toBe(200);
    const [row] = await db.select().from(bot).where(eq(bot.id, turnBot));
    const seen: string[] = [];
    const runner = createTurnRunner(db, async (i) => {
      seen.push(i.prompt);
      return "ok";
    });
    await runner({ userId: B, bot: row!, history: [], prompt: "Plan the sprint" });
    expect(seen[0]).toContain("Your place in the company chart");
    expect(seen[0]).toContain("Seat: Head of engineering (Executive, Engineering)");
    expect(seen[0]).toContain("Reports to: CEO, a seat nobody holds yet");
    expect(seen[0]).toContain("Reports to you: Engineering manager: an open seat");
    // The request still comes last, after the chart.
    expect(seen[0]!.indexOf("<<<ORG-")).toBeLessThan(seen[0]!.indexOf("User: Plan the sprint"));
    // Outside people in play: nothing of the company goes into the reply.
    await runner({ userId: B, bot: row!, history: [], prompt: "Plan the sprint", noCode: true });
    expect(seen[1]).not.toContain("company chart");
    // A bot that holds no seat reads nothing about the chart.
    const idle = await newBot(B, "Idle", { harness: "claude-code" });
    const [idleRow] = await db.select().from(bot).where(eq(bot.id, idle));
    await runner({ userId: B, bot: idleRow!, history: [], prompt: "Hello" });
    expect(seen[2]).not.toContain("company chart");
    // The loader the turn uses gives the same text, and the chief gets the top of the company instead.
    expect(await orgContextFor(db, B, { id: turnBot, kind: "specialist" })).toContain(
      "Seat: Head of engineering",
    );
    const top = await orgContextFor(db, ADMIN, { id: chiefBot, kind: "chief" });
    expect(top).toContain("The user you work for holds: no seat");
    expect(top).toContain("CEO (CEO, Company): an open seat");
    expect(top).toContain("  Head of engineering (Executive, Engineering): ");
  });

  test("the chart tool is in the prompt of the administrator's own specialist only, never in another member's or a shared one", async () => {
    const seenPrompts: string[] = [];
    // The tool playbook travels as the system text for this engine, apart from the turn text.
    const runner = createTurnRunner(db, async (i: { prompt: string; system?: string }) => {
      seenPrompts.push(`${i.system ?? ""}\n${i.prompt}`);
      return "ok";
    });
    const asAdmin = await newBot(ADMIN, "Mine", { harness: "claude-code" });
    const [adminRow] = await db.select().from(bot).where(eq(bot.id, asAdmin));
    await runner({ userId: ADMIN, bot: adminRow!, history: [], prompt: "Hello" });
    expect(seenPrompts[0]).toContain("zetta:org");
    expect(seenPrompts[0]).toContain("You are the administrator's bot, so you may read the chart");
    // The extra block stays short: it is read on every turn of every bot of the administrator.
    expect(ORG_BOT_TOOLS.length).toBeLessThan(750);
    // With outside people in play, nothing of it.
    await runner({ userId: ADMIN, bot: adminRow!, history: [], prompt: "Hello", noCode: true });
    expect(seenPrompts[1]).not.toContain("zetta:org");
    // A member's own bot, and the administrator's bot used by a member, get nothing.
    const memberBot = await newBot(B, "Theirs", { harness: "claude-code" });
    const [memberRow] = await db.select().from(bot).where(eq(bot.id, memberBot));
    await runner({ userId: B, bot: memberRow!, history: [], prompt: "Hello" });
    expect(seenPrompts[2]).not.toContain("zetta:org");
    await runner({ userId: B, bot: adminRow!, history: [], prompt: "Hello" });
    expect(seenPrompts[3]).not.toContain("zetta:org");
    // The chief has it inside its own playbook, so the extra block is not added twice.
    const [chiefRow] = await db.select().from(bot).where(eq(bot.id, chiefBot));
    await runner({
      userId: ADMIN,
      bot: { ...chiefRow!, harness: "claude-code" },
      history: [],
      prompt: "Hello",
    });
    expect(seenPrompts[4]).toContain("zetta:org");
    expect(seenPrompts[4]).not.toContain("You are the administrator's bot");
  });

  test("a team room is told who the chart says leads its team", async () => {
    const lead = seatOf(await get(), "Head of engineering");
    await write("PATCH", `/api/org/positions/${lead.id}`, { teamId: adminTeam });
    const { positions } = await readOrg(db, ADMIN);
    expect(teamLeadLine(positions, adminTeam)).toContain("this team is led by [@Turner](bot:");
    expect(teamLeadLine(positions, otherTeam)).toBe("");
  });

  test("the chief draws the chart for an administrator: every change is a plan, applying it uses the same store, and anyone else is refused", async () => {
    await wipe();
    const chief = createChief({ db, chat: {} as never, org });
    const admin = { userId: ADMIN, isAdmin: true } as never;
    const member = { userId: B, isAdmin: false } as never;
    const who = { id: chiefBot, name: "Zeta", kind: "chief", ownerUserId: ADMIN } as never;
    const run = (actor: never, args: object) => chief.run(actor, who, "org", args);
    const planOf = async (args: object) => {
      const out = await run(admin, args);
      if (!("plan" in out)) throw new Error(`no plan: ${JSON.stringify(out)}`);
      return out.plan;
    };
    const applyAll = async (args: object) => {
      const plan = await planOf(args);
      await chief.apply(admin, plan.patch as never);
      return plan;
    };

    // Reading is open; changing is not.
    expect(await run(member, { action: "list" })).toMatchObject({
      read: expect.stringContaining("org.list"),
    });
    expect(await run(member, { action: "add_seat", template: "ceo" })).toEqual({
      error: "only an administrator can change the company chart.",
    });
    expect(isChiefWrite({ kind: "org", args: { action: "list" } })).toBe(false);
    expect(isChiefWrite({ kind: "org", args: { action: "add_seat", template: "ceo" } })).toBe(true);

    // The first seat is the CEO.
    expect(await run(admin, { action: "add_seat", template: "cto" })).toEqual({
      error: "start the chart with the CEO.",
    });
    const first = await applyAll({ action: "add_seat", template: "ceo" });
    expect(first.title).toBe("Add the seat CEO");
    expect((await get()).positions.map((p) => p.title)).toEqual(["CEO"]);

    // A seat under a seat, named by its title; a seat held by a person (by id) and by a bot (by name).
    await applyAll({ action: "add_seat", under: "CEO", template: "cto" });
    await applyAll({
      action: "add_seat",
      under: "CEO",
      title: "Chief of staff",
      rank: "executive",
    });
    expect((await get()).positions.map((p) => p.title)).toEqual(["CEO", "CTO", "Chief of staff"]);
    const held = await planOf({ action: "seat", seat: "CTO", holder: { kind: "person", who: B } });
    expect(held.diff).toContainEqual({ field: "held by", from: null, to: expect.any(String) });
    await chief.apply(admin, held.patch as never);
    await applyAll({
      action: "seat",
      seat: "Chief of staff",
      holder: { kind: "bot", who: "Scribe" },
    });
    const after = await get();
    expect(seatOf(after, "CTO").holder).toMatchObject({ kind: "person", userId: B });
    expect(seatOf(after, "Chief of staff").holder).toMatchObject({ kind: "bot", botId: teamBot });
    // A private bot is not offered to the chief at all.
    expect(
      await run(admin, { action: "seat", seat: "CTO", holder: { kind: "bot", who: "Hidden" } }),
    ).toMatchObject({
      error: expect.stringContaining('no bot shared with the team called "Hidden"'),
    });

    // Moves are checked when planned, so a loop never becomes a card.
    expect(await run(admin, { action: "move", seat: "CEO", under: "CTO" })).toEqual({
      error: "The CEO is the top of the chart and does not report to anyone.",
    });
    await applyAll({ action: "move", seat: "Chief of staff", under: "CTO" });
    expect(seatOf(await get(), "Chief of staff").parentId).toBe(seatOf(await get(), "CTO").id);
    expect(await run(admin, { action: "move", seat: "CTO", under: "Chief of staff" })).toEqual({
      error: "A seat cannot report to one of its own reports.",
    });

    // Names that are not unique are refused with the way out; an unknown one says so.
    await applyAll({ action: "add_seat", under: "CEO", template: "software-engineer" });
    await applyAll({ action: "add_seat", under: "CTO", template: "software-engineer" });
    expect(await run(admin, { action: "remove", seat: "Software engineer" })).toEqual({
      error: '2 seats are called "Software engineer". Use the id of one of them.',
    });
    expect(await run(admin, { action: "remove", seat: "Nobody here" })).toMatchObject({
      error: expect.stringContaining('no seat called "Nobody here"'),
    });

    // Templates: a company needs an empty chart; a team hangs under a seat.
    expect(await run(admin, { action: "apply_template", template: "small-startup" })).toEqual({
      error:
        "a whole company template needs an empty chart. Use a team template under a seat instead.",
    });
    expect(await run(admin, { action: "apply_template", template: "support-desk" })).toEqual({
      error: "say which seat this team reports to (under).",
    });
    const before = (await get()).positions.length;
    await applyAll({ action: "apply_template", template: "support-desk", under: "CTO" });
    expect((await get()).positions).toHaveLength(before + 5);

    // The list shows ids, so the chief can use one when a title is not unique.
    const listing = await run(admin, { action: "list" });
    expect("read" in listing && listing.read).toContain('"reportsTo":"CEO"');
    const dev = (await get()).positions.find((p) => p.title === "Software engineer")!;
    await applyAll({ action: "remove", seat: dev.id });
    expect((await get()).positions.find((p) => p.id === dev.id)).toBeUndefined();

    // A change approved after somebody else changed the chart still works on what is there; one for a seat that is gone does not.
    const stalePlan = await planOf({ action: "remove", seat: "Chief of staff" });
    await write("DELETE", `/api/org/positions/${seatOf(await get(), "Chief of staff").id}`);
    await expect(chief.apply(admin, stalePlan.patch as never)).rejects.toThrow();
  });

  test("the chief edits a seat, links a team of the admin and reorders: each is a plan, applied through the store", async () => {
    await wipe();
    const chief = createChief({ db, chat: {} as never, org });
    const admin = { userId: ADMIN, isAdmin: true } as never;
    const member = { userId: B, isAdmin: false } as never;
    const who = { id: chiefBot, name: "Zeta", kind: "chief", ownerUserId: ADMIN } as never;
    const run = (actor: never, args: object) => chief.run(actor, who, "org", args);
    const applyAll = async (args: object) => {
      const out = await run(admin, args);
      if (!("plan" in out)) throw new Error(`no plan: ${JSON.stringify(out)}`);
      await chief.apply(admin, out.plan.patch as never);
      return out.plan;
    };
    await applyAll({ action: "add_seat", template: "ceo" });
    await applyAll({
      action: "add_seat",
      under: "CEO",
      template: "cto",
      unit: "Tech",
      description: "Runs the tech.",
    });
    await applyAll({ action: "add_seat", under: "CEO", template: "cfo" });
    await applyAll({ action: "add_seat", under: "CEO", template: "coo" });
    expect(seatOf(await get(), "CTO")).toMatchObject({
      unit: "Tech",
      description: "Runs the tech.",
    });

    // Edit the words and the level; the card lists only what changes.
    const edit = await run(admin, {
      action: "update",
      seat: "CTO",
      title: "Head of technology",
      rank: "lead",
      unit: "Tech",
      description: "Runs all the tech.",
    });
    expect(edit).toMatchObject({ plan: { title: "Change the seat CTO" } });
    expect("plan" in edit && edit.plan.diff.map((d) => d.field)).toEqual([
      "title",
      "level",
      "responsible for",
    ]);
    await chief.apply(admin, ("plan" in edit ? edit.plan.patch : {}) as never);
    expect(seatOf(await get(), "Head of technology")).toMatchObject({
      rank: "lead",
      unit: "Tech",
      description: "Runs all the tech.",
    });

    // The team link: the admin's own team by name; null unlinks; somebody else's team is not offered.
    await applyAll({ action: "update", seat: "Head of technology", team: `Crew ${ADMIN}` });
    expect(seatOf(await get(), "Head of technology").team?.id).toBe(adminTeam);
    expect(await run(admin, { action: "update", seat: "COO", team: `Crew ${B}` })).toMatchObject({
      error: expect.stringContaining('no team of yours called "Crew'),
    });
    await applyAll({ action: "update", seat: "Head of technology", team: null });
    expect(seatOf(await get(), "Head of technology").team).toBeNull();

    // Rules that would be refused later are refused when planned.
    expect(await run(admin, { action: "update", seat: "CEO", rank: "lead" })).toEqual({
      error: "The CEO seat stays the CEO.",
    });
    expect(await run(admin, { action: "update", seat: "COO", rank: "ceo" })).toEqual({
      error: "There can be only one CEO.",
    });
    expect(await run(admin, { action: "update", seat: "COO", title: "COO" })).toEqual({
      error: "the seat already looks like that.",
    });

    // Reorder with an index only: the seat keeps its manager.
    const kids = async () => {
      const view = await get();
      const ceo = seatOf(view, "CEO");
      return view.positions.filter((p) => p.parentId === ceo.id).map((p) => p.title);
    };
    expect(await kids()).toEqual(["Head of technology", "CFO", "COO"]);
    const moved = await run(admin, { action: "move", seat: "COO", index: 0 });
    expect(moved).toMatchObject({ plan: { title: "Reorder COO" } });
    await chief.apply(admin, ("plan" in moved ? moved.plan.patch : {}) as never);
    expect(await kids()).toEqual(["COO", "Head of technology", "CFO"]);
    expect(await run(admin, { action: "move", seat: "CEO", index: 0 })).toEqual({
      error: "The CEO is the top of the chart and does not report to anyone.",
    });

    // Only an administrator asks for a change; a member may still read.
    expect(await run(member, { action: "update", seat: "COO", title: "Chief operator" })).toEqual({
      error: "only an administrator can change the company chart.",
    });
    expect(await run(member, { action: "list" })).toMatchObject({ read: expect.any(String) });
  });

  test("the chief's org block is read from a reply, and a wrong one is turned away", () => {
    const fence = (body: string) => "```zetta:org\n" + body + "\n```";
    const ok = parseTools(
      fence('{"action":"add_seat","under":"CTO","template":"software-engineer"}'),
    );
    expect(ok.rejected).toEqual([]);
    expect(ok.calls.map((c) => c.kind)).toEqual(["org"]);
    expect(
      parseTools(fence('{"action":"seat","seat":"CTO","holder":{"kind":"bot","who":"Scribe"}}'))
        .calls,
    ).toHaveLength(1);
    // Unknown actions, fields and holder kinds never become calls.
    for (const bad of [
      '{"action":"burn"}',
      '{"action":"add_seat","template":"cto","admin":true}',
      '{"action":"seat","seat":"CTO","holder":{"kind":"robot","who":"x"}}',
      '{"action":"add_seat","rank":"emperor"}',
      '{"action":"update","seat":"CTO"}',
      '{"action":"move","seat":"CTO"}',
    ])
      expect(parseTools(fence(bad)).calls).toEqual([]);
  });

  test("the chart holds a limited number of seats", async () => {
    const view = await get();
    const root = view.positions.find((p) => p.parentId === null)!;
    const room = ORG_MAX_POSITIONS - view.positions.length;
    await db.$client.query(
      `insert into org_position (chart_id, parent_id, rank, title, sort_order)
       select $1, $2, 'member', 'Filler ' || g, 1000 + g from generate_series(1, $3) g`,
      [view.chart.id, root.id, room],
    );
    const full = await write("POST", "/api/org/positions", {
      parentId: root.id,
      templateKey: "cto",
    });
    expect(full.status).toBe(400);
    expect(full.error!.message).toBe(`The chart can have at most ${ORG_MAX_POSITIONS} seats.`);
  });
});

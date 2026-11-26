import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, tenant } from "@zetta/db";
import { and, asc, eq, inArray, or } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import {
  identityAudit,
  installationIdentity,
  invitation,
  membership,
} from "@zetta/db/schema/identity";
import {
  chiefShare,
  invitationGrant,
  workspace,
  workspaceMember,
} from "@zetta/db/schema/workspaces";
import { createApp } from "../../app";
import { createChatService } from "../chat/service";
import { cleanupTestUsers, dropTestWorkspaces } from "../../test-support/db-cleanup";
import { AccessError, createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createAdminLifecycleService } from "../identity/admin-lifecycle";
import { createEnrollmentService, EnrollmentUnavailableError } from "../identity/enrollment";
import { adminLifecycleHooks, enrollmentHooks } from "./identity-hooks";
import { chiefFor } from "./chief";
import { createWorkspaceLookup } from "./lookup";
import { requestedWorkspace } from "./request-context";
import { createWorkspaceService, WorkspaceError } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const tag = uuidv7().slice(-8);
const id = (name: string) => `ws-${name}-${tag}`;
const ROOT = id("root");
const ADMIN = id("admin");
const MEMBER = id("member");
const NEWBIE = id("newbie");
const LATE = id("late");
const LOOSE = id("loose");
const ACME = id("acme");
const BOTH = id("both");
const ALL = [ROOT, ADMIN, MEMBER, NEWBIE, LATE, LOOSE, ACME, BOTH];
const email = (userId: string) => `${userId}@example.invalid`;

suite("workspaces against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lifecycle = createAdminLifecycleService(db, adminLifecycleHooks);
  const enrollment = createEnrollmentService(db, enrollmentHooks);
  const lookup = createWorkspaceLookup(db);
  const audits: string[] = [];
  const workspaces = createWorkspaceService(db, {
    audit: (userId, event) => void audits.push(`${userId} ${event.subjectId} ${event.detail}`),
  });
  const actor = async (userId: string) => (await issueBackgroundActor(lookup, userId))!;
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const userId = headers.get("x-test-user");
          return userId ? { user: { id: userId } } : null;
        },
      },
    },
    lookup,
  );
  /** The engine of this test answers with the name of the bot it was asked to be, and remembers who asked. */
  const runs: { botId: string; userId: string | undefined }[] = [];
  type Run = { bot: { id: string; name: string }; userId?: string };
  const answer = (run: Run) => {
    runs.push({ botId: run.bot.id, userId: run.userId });
    return `I am ${run.bot.name}`;
  };
  const fakeRun = Object.assign(async (run: Run) => ({ text: answer(run), stopped: false }), {
    stream: async function* (run: Run) {
      yield answer(run);
    },
  });
  const chat = createChatService(db, fakeRun as never);
  const chiefOf = async (who: Awaited<ReturnType<typeof actor>>) => (await chat.ensureChief(who))!;
  const WEB = "http://web.test";
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    identity: { access, enrollment },
    workspaces: { access, workspaces },
    webOrigin: WEB,
    desktopOrigins: [],
  });
  const call = (
    userId: string,
    method: string,
    path: string,
    body?: unknown,
    origin = WEB,
    extra: Record<string, string> = {},
  ) =>
    app.handle(
      new Request(`http://api.test${path}`, {
        method,
        headers: {
          ...extra,
          "x-test-user": userId,
          ...(origin ? { origin } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  let rootBot = "";
  /** Workspaces a test started, removed at the end. */
  const made: string[] = [];
  let otherBot = "";

  const place = async (userId: string) =>
    (
      await db
        .select({
          workspaceId: workspaceMember.workspaceId,
          role: workspaceMember.role,
          status: workspaceMember.status,
        })
        .from(workspaceMember)
        .where(eq(workspaceMember.userId, userId))
    )[0];

  /** Sends an invitation as `from` and accepts it as `to`. */
  async function join(from: string, to: string, extra: Record<string, unknown> = {}) {
    const issued = await enrollment.issueInvitation(
      { userId: from },
      { intendedEmail: email(to), ...extra },
    );
    await enrollment.acceptInvitation({ userId: to }, { token: issued.token });
    return issued.invitationId;
  }

  const newBot = async (owner: string, name: string) => {
    const [row] = await db
      .insert(bot)
      .values({
        ownerUserId: owner,
        kind: "specialist",
        visibility: "team",
        name,
        slug: `${name}-${tag}`,
      })
      .returning({ id: bot.id });
    return row!.id;
  };

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ALL.map((userId) => ({
        id: userId,
        name: userId,
        email: email(userId),
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    // The server of this test is set up by ROOT, through the real operation.
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    await lifecycle.bootstrapExistingAccount({ userId: ROOT });
    rootBot = await newBot(ROOT, "ws-root-bot");
  });

  afterAll(async () => {
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    const invitations = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        or(inArray(invitation.issuedByUserId, ALL), inArray(invitation.consumedByUserId, ALL)),
      );
    const ids = invitations.map((row) => row.id);
    await db
      .delete(identityAudit)
      .where(
        or(inArray(identityAudit.subjectUserId, ALL), inArray(identityAudit.actorUserId, ALL)),
      );
    if (ids.length) {
      await db.delete(invitationGrant).where(inArray(invitationGrant.invitationId, ids));
      await db.delete(invitation).where(inArray(invitation.id, ids));
    }
    // The workspaces the multi-workspace tests started, with what is in them.
    await dropTestWorkspaces(db, made);
    // The bots, their chats and their settings go with their owners.
    await cleanupTestUsers(db, ALL);
    // The workspace this test's bootstrap may have created, when nobody else is in it.
    await db.$client.query(
      "delete from workspace w where not exists (select 1 from workspace_member m where m.workspace_id = w.id) and not exists (select 1 from invitation_grant g where g.workspace_id = w.id) and w.id <> (select f.id from workspace f order by f.created_at, f.id limit 1) and not exists (select 1 from bot b where b.workspace_id = w.id)",
    );
    await db.$client.end();
  });

  test("the first account gets the first workspace, as its owner and as root", async () => {
    const mine = await place(ROOT);
    expect(mine).toMatchObject({ role: "owner", status: "active" });
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, mine!.workspaceId));
    expect(ws).toMatchObject({ status: "active" });
    expect(await lookup(ROOT)).toEqual({
      isAdmin: true,
      isRoot: true,
      role: "owner",
      workspaceId: mine!.workspaceId,
    });
  });

  test("an invitation with nothing more joins the inviter's workspace as a member", async () => {
    const invitationId = await join(ROOT, MEMBER);
    const mine = await place(MEMBER);
    expect(mine).toMatchObject({ role: "member", workspaceId: (await place(ROOT))!.workspaceId });
    expect(await lookup(MEMBER)).toMatchObject({ isAdmin: false, isRoot: false, role: "member" });
    const [grant] = await db
      .select()
      .from(invitationGrant)
      .where(eq(invitationGrant.invitationId, invitationId));
    expect(grant).toMatchObject({ role: "member", chiefBotId: null });
  });

  test("an invitation can make an administrator, who administers and is not root", async () => {
    await join(ROOT, ADMIN, { role: "admin" });
    expect(await lookup(ADMIN)).toMatchObject({ isAdmin: true, isRoot: false, role: "admin" });
  });

  test("an administrator invites members and revokes; granting a role above member is the owner's", async () => {
    const issued = await enrollment.issueInvitation(
      { userId: ADMIN },
      { intendedEmail: email(LATE) },
    );
    await enrollment.revokeInvitation({ userId: ADMIN }, { invitationId: issued.invitationId });
    await expect(
      enrollment.issueInvitation({ userId: ADMIN }, { intendedEmail: email(LATE), role: "admin" }),
    ).rejects.toThrow(EnrollmentUnavailableError);
    await expect(
      enrollment.issueInvitation({ userId: ADMIN }, { intendedEmail: email(LATE), role: "owner" }),
    ).rejects.toThrow(EnrollmentUnavailableError);
  });

  test("a member sends no invitation, and neither does a person who is not here", async () => {
    for (const from of [MEMBER, LOOSE])
      await expect(
        enrollment.issueInvitation({ userId: from }, { intendedEmail: email(LATE) }),
      ).rejects.toThrow(EnrollmentUnavailableError);
    // A refused invitation leaves nothing behind.
    const left = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(inArray(invitation.issuedByUserId, [MEMBER, LOOSE]));
    expect(left).toEqual([]);
  });

  test("a member revokes no invitation either: it stays usable until someone who administers revokes it", async () => {
    const issued = await enrollment.issueInvitation(
      { userId: ROOT },
      { intendedEmail: email(LATE) },
    );
    for (const from of [MEMBER, LOOSE])
      await expect(
        enrollment.revokeInvitation({ userId: from }, { invitationId: issued.invitationId }),
      ).rejects.toThrow(EnrollmentUnavailableError);
    const [still] = await db
      .select({ revokedAt: invitation.revokedAt })
      .from(invitation)
      .where(eq(invitation.id, issued.invitationId));
    expect(still?.revokedAt).toBeNull();
    await enrollment.revokeInvitation({ userId: ADMIN }, { invitationId: issued.invitationId });
  });

  test("a bot of the inviter becomes the new person's Chief; someone else's bot is refused", async () => {
    otherBot = await newBot(ADMIN, "ws-admin-bot");
    await expect(
      enrollment.issueInvitation(
        { userId: ROOT },
        { intendedEmail: email(NEWBIE), chiefBotId: otherBot },
      ),
    ).rejects.toThrow(EnrollmentUnavailableError);
    await expect(
      enrollment.issueInvitation(
        { userId: ROOT },
        { intendedEmail: email(NEWBIE), chiefBotId: "not-a-bot" },
      ),
    ).rejects.toThrow(EnrollmentUnavailableError);
    await join(ROOT, NEWBIE, { chiefBotId: rootBot });
    const [share] = await db.select().from(chiefShare).where(eq(chiefShare.userId, NEWBIE));
    expect(share).toMatchObject({ botId: rootBot, grantedByUserId: ROOT });
  });

  test("a bot archived before the invitation is used is not shared: the person still joins", async () => {
    const gone = await newBot(ROOT, "ws-gone-bot");
    const issued = await enrollment.issueInvitation(
      { userId: ROOT },
      { intendedEmail: email(LATE), chiefBotId: gone },
    );
    await db.update(bot).set({ archived: true }).where(eq(bot.id, gone));
    await enrollment.acceptInvitation({ userId: LATE }, { token: issued.token });
    expect(await place(LATE)).toMatchObject({ role: "member", status: "active" });
    expect(await db.select().from(chiefShare).where(eq(chiefShare.userId, LATE))).toEqual([]);
  });

  test("a person removed from the server is nobody, whatever their workspace row says", async () => {
    await db
      .update(membership)
      .set({ status: "removed", removedAt: new Date() })
      .where(eq(membership.userId, LATE));
    expect(await lookup(LATE)).toBeNull();
    expect((await place(LATE))?.status).toBe("active");
  });

  test("a member with no workspace row is a member, and root with no row still owns", async () => {
    await db.delete(workspaceMember).where(inArray(workspaceMember.userId, [MEMBER, ROOT]));
    expect(await lookup(MEMBER)).toEqual({ isAdmin: false, isRoot: false, role: "member" });
    // Root with no row stands in its own workspace, the first.
    expect(await lookup(ROOT)).toEqual({
      isAdmin: true,
      isRoot: true,
      role: "owner",
      workspaceId: expect.any(String),
    });
    // The next invitation root sends puts root back in the first workspace.
    const issued = await enrollment.issueInvitation(
      { userId: ROOT },
      { intendedEmail: email(LOOSE) },
    );
    expect(await place(ROOT)).toMatchObject({ role: "owner", status: "active" });
    await enrollment.revokeInvitation({ userId: ROOT }, { invitationId: issued.invitationId });
  });

  test("a hand-edited role cannot lock root out", async () => {
    await db
      .update(workspaceMember)
      .set({ role: "member" })
      .where(eq(workspaceMember.userId, ROOT));
    expect(await lookup(ROOT)).toMatchObject({ isAdmin: true, isRoot: true });
    await db.update(workspaceMember).set({ role: "owner" }).where(eq(workspaceMember.userId, ROOT));
  });

  test("a person sees their workspace and what they are in it", async () => {
    expect(await workspaces.mine(await actor(ROOT))).toMatchObject({
      workspace: { slug: expect.any(String), name: expect.any(String) },
      role: "owner",
      isRoot: true,
    });
    expect(await workspaces.mine(await actor(NEWBIE))).toMatchObject({
      role: "member",
      isRoot: false,
    });
  });

  test("an administrator sees the people of the workspace: no one removed, no one from outside", async () => {
    const { members } = await workspaces.members(await actor(ADMIN));
    const mine = members.filter((person) => ALL.includes(person.userId));
    expect(mine.map((person) => [person.userId, person.role, person.isRoot, person.isYou])).toEqual(
      [
        [ADMIN, "admin", false, true],
        [NEWBIE, "member", false, false],
        [ROOT, "owner", true, false],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(mine.find((person) => person.userId === NEWBIE)?.chief).toMatchObject({
      botId: rootBot,
      ownerUserId: ROOT,
    });
    await expect(workspaces.members(await actor(NEWBIE))).rejects.toBeInstanceOf(AccessError);
  });

  test("an administrator moves a member up and down, and touches no owner and not themselves", async () => {
    const admin = await actor(ADMIN);
    expect(await workspaces.setRole(admin, NEWBIE, "admin")).toEqual({
      userId: NEWBIE,
      role: "admin",
    });
    expect(await lookup(NEWBIE)).toMatchObject({ isAdmin: true, role: "admin" });
    for (const [who, role] of [
      [NEWBIE, "owner"],
      [ROOT, "admin"],
      [ADMIN, "member"],
    ] as const)
      await expect(workspaces.setRole(admin, who, role)).rejects.toMatchObject({
        code: "NOT_ALLOWED",
      });
    expect(audits).toContain(`${ADMIN} ${NEWBIE} role:admin`);
  });

  test("the role is read again when the change is made: a demoted administrator's old session changes nothing", async () => {
    const stale = await actor(NEWBIE);
    expect(stale.isAdmin).toBe(true);
    await workspaces.setRole(await actor(ROOT), NEWBIE, "member");
    await expect(workspaces.setRole(stale, ADMIN, "member")).rejects.toMatchObject({
      code: "NOT_ALLOWED",
    });
    await expect(workspaces.setChief(stale, ADMIN, rootBot)).rejects.toBeInstanceOf(AccessError);
    expect(await lookup(ADMIN)).toMatchObject({ role: "admin" });
  });

  test("root stays an owner, and a workspace never loses its last owner", async () => {
    const root = await actor(ROOT);
    await expect(workspaces.setRole(root, ROOT, "admin")).rejects.toThrow(
      "The person who set this server up stays an owner.",
    );
    // A second owner may not demote root either, and can step down while root remains.
    await workspaces.setRole(root, ADMIN, "owner");
    const second = await actor(ADMIN);
    await expect(workspaces.setRole(second, ROOT, "member")).rejects.toMatchObject({
      code: "NOT_ALLOWED",
    });
    expect(await workspaces.setRole(second, ADMIN, "admin")).toMatchObject({ role: "admin" });
  });

  test("a role is one of three, and the person is one of this workspace", async () => {
    const root = await actor(ROOT);
    await expect(workspaces.setRole(root, NEWBIE, "boss")).rejects.toMatchObject({
      code: "INVALID",
    });
    for (const outsider of [LATE, LOOSE, "nobody"])
      await expect(workspaces.setRole(root, outsider, "admin")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
  });

  test("an administrator shares one of their own bots as a person's Chief, and anyone who administers takes it away", async () => {
    const admin = await actor(ADMIN);
    await workspaces.setChief(admin, NEWBIE, otherBot);
    const [share] = await db.select().from(chiefShare).where(eq(chiefShare.userId, NEWBIE));
    expect(share).toMatchObject({ botId: otherBot, grantedByUserId: ADMIN });
    await expect(workspaces.setChief(admin, NEWBIE, rootBot)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(workspaces.setChief(admin, ADMIN, otherBot)).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(workspaces.setChief(admin, LOOSE, otherBot)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(workspaces.setChief(await actor(NEWBIE), ADMIN, otherBot)).rejects.toBeInstanceOf(
      AccessError,
    );
    await workspaces.setChief(await actor(ROOT), NEWBIE, null);
    expect(await db.select().from(chiefShare).where(eq(chiefShare.userId, NEWBIE))).toEqual([]);
    expect(audits).toContain(`${ROOT} ${NEWBIE} chief:removed`);
  });

  test("a shared Chief is the person's chief in their list, may be private to its owner, and no Chief of their own is made", async () => {
    // ADMIN keeps a private bot and gives it to NEWBIE.
    const [mine] = await db
      .insert(bot)
      .values({
        ownerUserId: ADMIN,
        kind: "specialist",
        visibility: "private",
        name: "ws-private-chief",
        slug: `ws-private-chief-${tag}`,
      })
      .returning({ id: bot.id });
    const shared = mine!.id;
    await workspaces.setChief(await actor(ADMIN), NEWBIE, shared);

    const newbie = await actor(NEWBIE);
    expect((await chiefOf(newbie)).id).toBe(shared);
    expect((await chiefFor(db, NEWBIE))?.id).toBe(shared);
    expect(await db.select({ id: bot.id }).from(bot).where(eq(bot.ownerUserId, NEWBIE))).toEqual(
      [],
    );
    const list = await chat.listBots(newbie);
    const card = list.find((b) => b.id === shared);
    // The card of a bot that is not theirs: what it is to them, and nothing of its owner's setup.
    expect(card).toMatchObject({ kind: "chief", instructions: "", ownerUserId: "" });
    expect(list.filter((b) => b.kind === "chief")).toHaveLength(1);
    // To its owner it is what it always was, and nobody else sees a private bot.
    expect((await chat.listBots(await actor(ADMIN))).find((b) => b.id === shared)?.kind).toBe(
      "specialist",
    );
    expect((await chat.listBots(await actor(ROOT))).some((b) => b.id === shared)).toBe(false);
    await expect(chat.createConversation(await actor(ROOT), shared)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  test("the person talks to their shared Chief in a chat of their own, and the turn is theirs", async () => {
    const shared = (await chiefFor(db, NEWBIE))!.id;
    const newbie = await actor(NEWBIE);
    const conversation = await chat.createConversation(newbie, shared);
    expect(conversation).toMatchObject({ ownerUserId: NEWBIE, botId: shared });
    runs.length = 0;
    const { follow } = await chat.startTurn(newbie, conversation!.id, { content: "hello" });
    let reply = "";
    for await (const { event } of follow())
      if (event.type === "message") reply = (event.message as { content: string }).content;
    expect(reply).toBe("I am ws-private-chief");
    expect(runs.at(-1)).toMatchObject({ botId: shared, userId: NEWBIE });
  });

  test("a person who already had a Chief sees it as one more bot of theirs while a shared one is theirs", async () => {
    const admin = await actor(ADMIN);
    const own = await chiefOf(admin);
    expect(own).toMatchObject({ ownerUserId: ADMIN, kind: "chief" });
    await workspaces.setChief(await actor(ROOT), ADMIN, rootBot);
    const list = await chat.listBots(admin);
    expect(list.find((b) => b.id === rootBot)?.kind).toBe("chief");
    expect(list.find((b) => b.id === own.id)?.kind).toBe("specialist");
    expect((await chiefOf(admin)).id).toBe(rootBot);
    // Taking the share away gives them their own Chief back.
    await workspaces.setChief(await actor(ROOT), ADMIN, null);
    expect((await chiefOf(admin)).id).toBe(own.id);
    expect((await chat.listBots(admin)).find((b) => b.id === own.id)?.kind).toBe("chief");
  });

  test("archiving the bot ends the share: the person gets a Chief of their own", async () => {
    const shared = (await chiefFor(db, NEWBIE))!.id;
    await db.update(bot).set({ archived: true }).where(eq(bot.id, shared));
    const own = await chiefOf(await actor(NEWBIE));
    expect(own).toMatchObject({ ownerUserId: NEWBIE, kind: "chief" });
    expect((await chat.listBots(await actor(NEWBIE))).some((b) => b.id === shared)).toBe(false);
    await workspaces.setChief(await actor(ROOT), NEWBIE, null);
  });

  test("the invitations waiting show what each one gives, and never a token", async () => {
    const issued = await enrollment.issueInvitation(
      { userId: ROOT },
      { intendedEmail: email(LOOSE), role: "admin", chiefBotId: rootBot },
    );
    const { invitations } = await workspaces.invitations(await actor(ADMIN));
    const mine = invitations.find((row) => row.invitationId === issued.invitationId);
    expect(mine).toMatchObject({
      intendedEmail: email(LOOSE),
      role: "admin",
      chief: { botId: rootBot, name: "ws-root-bot" },
    });
    expect(JSON.stringify(invitations)).not.toContain(issued.token);
    await enrollment.revokeInvitation({ userId: ROOT }, { invitationId: issued.invitationId });
    expect(
      (await workspaces.invitations(await actor(ADMIN))).invitations.some(
        (row) => row.invitationId === issued.invitationId,
      ),
    ).toBe(false);
    await expect(workspaces.invitations(await actor(NEWBIE))).rejects.toBeInstanceOf(AccessError);
  });

  test("an owner renames the workspace; an administrator does not", async () => {
    const before = (await workspaces.mine(await actor(ROOT))).workspace.name;
    await expect(workspaces.rename(await actor(ADMIN), "Mine now")).rejects.toBeInstanceOf(
      AccessError,
    );
    await expect(workspaces.rename(await actor(ROOT), "   ")).rejects.toMatchObject({
      code: "INVALID",
    });
    expect(await workspaces.rename(await actor(ROOT), `  Test ${tag}  `)).toMatchObject({
      name: `Test ${tag}`,
    });
    await workspaces.rename(await actor(ROOT), before);
  });

  test("over HTTP: a member reads their workspace, changes need the app's own origin and the right role", async () => {
    const mine = await call(NEWBIE, "GET", "/api/workspace/");
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ role: "member", isRoot: false });
    expect((await call(NEWBIE, "GET", "/api/workspace/members")).status).toBe(403);
    expect((await call(LOOSE, "GET", "/api/workspace/")).status).toBe(403);
    const role = { role: "admin" };
    const path = `/api/workspace/members/${NEWBIE}/role`;
    expect((await call(ROOT, "PUT", path, role, "http://evil.test")).status).toBe(403);
    expect((await call(NEWBIE, "PUT", path, role)).status).toBe(403);
    expect((await call(ROOT, "PUT", path, { role: "boss" })).status).toBe(400);
    const done = await call(ROOT, "PUT", path, role);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ userId: NEWBIE, role: "admin" });
    expect((await call(ROOT, "PUT", path, { role: "member" })).status).toBe(200);
  });

  test("over HTTP: an invitation carries a role and a Chief, within what the sender may give", async () => {
    const invite = (from: string, extra: Record<string, unknown>) =>
      call(from, "POST", "/api/identity/invitations", { intendedEmail: email(LOOSE), ...extra });
    expect((await invite(ADMIN, { role: "admin" })).status).toBe(409);
    expect((await invite(ROOT, { role: "owner" })).status).toBe(400);
    expect((await invite(ROOT, { chiefBotId: "not-a-uuid" })).status).toBe(400);
    const sent = await invite(ROOT, { role: "admin", chiefBotId: rootBot });
    expect(sent.status).toBe(201);
    const { invitationId } = (await sent.json()) as { invitationId: string };
    const [grant] = await db
      .select()
      .from(invitationGrant)
      .where(eq(invitationGrant.invitationId, invitationId));
    expect(grant).toMatchObject({ role: "admin", chiefBotId: rootBot });
    await enrollment.revokeInvitation({ userId: ROOT }, { invitationId });
  });

  test("replacing the admin hands the ownership over and leaves the previous one a member", async () => {
    await lifecycle.replaceAdminWithExistingAccount({
      expectedAdminUserId: ROOT,
      newAdminUserId: ADMIN,
      reason: "workspace test",
    });
    expect(await lookup(ADMIN)).toMatchObject({ isAdmin: true, isRoot: true, role: "owner" });
    expect(await lookup(ROOT)).toMatchObject({ isAdmin: false, isRoot: false, role: "member" });
    const owners = await db
      .select({ userId: workspaceMember.userId })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.role, "owner"), inArray(workspaceMember.userId, ALL)));
    expect(owners).toEqual([{ userId: ADMIN }]);
  });

  describe("more than one workspace", () => {
    const service = createWorkspaceService(db, {
      invite: (who, input) => enrollment.issueInvitation(who, input),
    });
    const rootNow = async () =>
      (
        await db
          .select({ id: installationIdentity.adminUserId })
          .from(installationIdentity)
          .where(eq(installationIdentity.id, 1))
      )[0]!.id;
    let acme = { id: "", slug: "" };
    /** The first workspace: root's own, where everyone of this file's other tests is. */
    const firstId = async () =>
      (
        await db
          .select({ id: workspace.id })
          .from(workspace)
          .orderBy(asc(workspace.createdAt), asc(workspace.id))
          .limit(1)
      )[0]!.id;

    test("root starts a workspace for another organization: its owner joins it, and root has no seat in it", async () => {
      const root = await rootNow();
      const started = await service.create(await actor(root), {
        name: "Acme",
        slug: `acme-${tag}`,
        ownerEmail: email(ACME),
      });
      made.push(started.workspace.id);
      acme = started.workspace;
      // The new person signs up with it, as anyone invited: and is the owner of the new workspace, alone in it.
      await enrollment.acceptInvitation({ userId: ACME }, { token: started.invitation.token });
      expect(await lookup(ACME)).toMatchObject({
        workspaceId: acme.id,
        role: "owner",
        isAdmin: true,
      });
      const people = await db
        .select({ userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(eq(workspaceMember.workspaceId, acme.id));
      expect(people).toEqual([{ userId: ACME }]);
      // Root asks for that workspace and stands in its own.
      expect(await lookup(root, acme.slug)).toBeNull();
      expect(await lookup(root, acme.id)).toBeNull();
    });

    test("only root starts a workspace, with an address name that is free and well formed", async () => {
      const root = await rootNow();
      await expect(
        service.create(await actor(MEMBER), {
          name: "Mine",
          slug: `mine-${tag}`,
          ownerEmail: email(MEMBER),
        }),
      ).rejects.toBeInstanceOf(AccessError);
      for (const slug of [acme.slug, "-bad", "UPPER CASE", "x"])
        await expect(
          service.create(await actor(root), { name: "Again", slug, ownerEmail: email(BOTH) }),
        ).rejects.toBeInstanceOf(WorkspaceError);
    });

    test("a person already here joins a second workspace with an invitation for them, once", async () => {
      // BOTH is in the first workspace already.
      await join(await rootNow(), BOTH);
      const invited = await tenant.run(acme.id, () =>
        enrollment.issueInvitation({ userId: ACME }, { intendedEmail: email(BOTH) }),
      );
      // Not for someone else.
      await expect(service.join(await actor(MEMBER), invited.token)).rejects.toBeInstanceOf(
        WorkspaceError,
      );
      expect((await service.join(await actor(BOTH), invited.token)).workspace.id).toBe(acme.id);
      // Used up.
      await expect(service.join(await actor(BOTH), invited.token)).rejects.toBeInstanceOf(
        WorkspaceError,
      );
      const mine = await service.all(await actor(BOTH));
      expect(mine.workspaces.map((w) => w.id).sort()).toEqual([acme.id, await firstId()].sort());
      expect(mine.mayCreate).toBe(false);
    });

    test("a person in two workspaces works in the one the request names, sees its rows only, and is placed in their own otherwise", async () => {
      const first = await firstId();
      const inAcme = (await lookup(BOTH, acme.slug))!;
      expect(inAcme).toMatchObject({ workspaceId: acme.id, role: "member", isAdmin: false });
      expect((await lookup(BOTH))!.workspaceId).toBe(first);
      // A bot made while working in Acme is Acme's, and not seen from the first workspace.
      const acmeBot = await tenant.run(acme.id, () => newBot(BOTH, "ws-acme-bot"));
      const seen = (workspaceId: string) =>
        tenant.run(workspaceId, () =>
          db.select({ id: bot.id }).from(bot).where(eq(bot.id, acmeBot)),
        );
      expect(await seen(acme.id)).toEqual([{ id: acmeBot }]);
      expect(await seen(first)).toEqual([]);
      // Through the identity check of a request: the header names Acme, or a workspace the person is not in.
      const statusIn = (named: string | undefined) =>
        tenant.open(() => access.status(new Headers({ "x-test-user": BOTH })), named) as Promise<{
          workspaceId?: string;
        }>;
      expect((await statusIn(acme.slug)).workspaceId).toBe(acme.id);
      expect((await statusIn(`nowhere-${tag}`)).workspaceId).toBe(first);
      expect((await statusIn(undefined)).workspaceId).toBe(first);
    });

    test("over HTTP, a call names the workspace it works in, and works there", async () => {
      // As a listening server is: `listen` compiles the app first, which rebuilds its `fetch`.
      (app as unknown as { compile(): unknown }).compile();
      const current = async (extra: Record<string, string>) =>
        (
          (await (await call(BOTH, "GET", "/api/workspace/all", undefined, WEB, extra)).json()) as {
            workspaces: { slug: string; current: boolean }[];
          }
        ).workspaces.find((w) => w.current)?.slug;
      expect(await current({ "x-zetta-workspace": acme.slug })).toBe(acme.slug);
      expect(await current({})).not.toBe(acme.slug);
    });

    test("the workspace a request names comes from its header, or its address where a header cannot be set", () => {
      const named = (url: string, headers: Record<string, string> = {}) =>
        requestedWorkspace(new Request(url, { headers }));
      expect(named("http://x/api/bots", { "x-zetta-workspace": "acme" })).toBe("acme");
      expect(named("http://x/api/events?w=acme")).toBe("acme");
      expect(named("http://x/api/events?w=../../etc")).toBeUndefined();
      expect(named("http://x/api/bots", { "x-zetta-workspace": "a b" })).toBeUndefined();
      expect(named("http://x/api/bots")).toBeUndefined();
    });

    test("an invitation joins the workspace its sender works in now", async () => {
      const sent = await tenant.run(acme.id, () =>
        enrollment.issueInvitation({ userId: ACME }, { intendedEmail: email(LOOSE) }),
      );
      const [grant] = await db
        .select({ workspaceId: invitationGrant.workspaceId, role: invitationGrant.role })
        .from(invitationGrant)
        .where(eq(invitationGrant.invitationId, sent.invitationId));
      expect(grant).toEqual({ workspaceId: acme.id, role: "member" });
    });
  });
});

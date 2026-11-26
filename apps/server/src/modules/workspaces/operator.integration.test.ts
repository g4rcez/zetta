// Root's view of whole workspaces (operator.ts): limits, suspending, a copy, deleting. Real rows in two workspaces, through the wall.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb, tenant } from "@zetta/db";
import { eq, inArray, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, botRevision, conversation, folder, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { setting } from "@zetta/db/schema/settings";
import { team, teamMember } from "@zetta/db/schema/teams";
import { invitationGrant, workspace, workspaceMember } from "@zetta/db/schema/workspaces";
import { cleanupTestUsers, dropTestWorkspaces } from "../../test-support/db-cleanup";
import { HarnessError } from "../chat/harness";
import {
  AccessError,
  createIdentityAccess,
  issueBackgroundActor,
  type ActiveActor,
} from "../identity/access";
import { createWorkspaceLookup } from "./lookup";
import { createOperator } from "./operator";
import { createQuotas } from "./quotas";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("root's view of whole workspaces", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const owner = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never, {
    wall: "off",
  });
  const tag = uuidv7().slice(-8);
  const KEEP = `op-keep-${tag}`;
  const GONE = `op-gone-${tag}`;
  const A = uuidv7();
  const B = uuidv7();
  const quotas = createQuotas(db);
  const audits: string[] = [];
  const operator = createOperator(db, {
    quotas,
    audit: (userId, e) => void audits.push(`${userId} ${e.subjectId} ${e.detail}`),
  });
  const lookup = createWorkspaceLookup(db);
  const issue = async (userId: string, standing: object) =>
    (await issueBackgroundActor(async () => ({ isAdmin: true, ...standing }), userId))!;
  let root: ActiveActor;
  let bOwner: ActiveActor;
  let member: ActiveActor;
  const count = async (workspaceId: string) => {
    const tables = await owner.execute<{ name: string }>(sql`
      select table_name as name from information_schema.columns
      where table_schema = 'zetta' and column_name = 'workspace_id'
        and table_name not in ('workspace', 'workspace_member', 'invitation_grant', 'workspace_quota', 'usage_counter')`);
    let total = 0;
    for (const { name } of tables.rows) {
      const r = await owner.execute<{ n: number }>(
        sql.raw(
          `select count(*)::int as n from zetta."${name}" where workspace_id = '${workspaceId}'`,
        ),
      );
      total += r.rows[0]!.n;
    }
    return total;
  };

  // `count`: the rows of a workspace's data, not of the bookkeeping about it (who is in it, what it used), which a delete treats apart.
  /** A little of everything in one workspace: a bot with a revision, a folder, a team with the bot in it, a chat with a message. */
  const seed = (workspaceId: string, ownerUserId: string) =>
    tenant.run(workspaceId, async () => {
      const [b] = await db
        .insert(bot)
        .values({
          ownerUserId,
          kind: "specialist",
          visibility: "team",
          name: "Bot",
          slug: `op-${tag}`,
        })
        .returning({ id: bot.id });
      await db
        .insert(botRevision)
        .values({ botId: b!.id, version: 1, config: {}, changedByUserId: ownerUserId });
      await db.insert(folder).values({ ownerUserId, name: `F ${tag}` });
      const [t] = await db
        .insert(team)
        .values({ ownerUserId, name: `T ${tag}` })
        .returning({ id: team.id });
      await db.insert(teamMember).values({ teamId: t!.id, botId: b!.id });
      const [c] = await db
        .insert(conversation)
        .values({ ownerUserId, botId: b!.id, title: "Hello" } as never)
        .returning({ id: conversation.id });
      await db.insert(message).values({
        conversationId: c!.id,
        ownerUserId,
        seq: 1,
        role: "user",
        content: "hi",
        status: "complete",
      } as never);
      return b!.id;
    });

  beforeAll(async () => {
    const now = new Date();
    await owner.insert(user).values(
      [KEEP, GONE].map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await owner.insert(membership).values(
      [KEEP, GONE].map((userId) => ({
        userId,
        status: "active" as const,
        joinedAt: now,
        updatedAt: now,
      })),
    );
    await owner.insert(workspace).values([
      { id: A, slug: `op-a-${tag}`, name: "Keeps" },
      { id: B, slug: `op-b-${tag}`, name: "Goes" },
    ]);
    await owner.insert(workspaceMember).values([
      { workspaceId: A, userId: KEEP, role: "owner", status: "active" },
      { workspaceId: B, userId: GONE, role: "owner", status: "active" },
    ]);
    await seed(A, KEEP);
    await seed(B, GONE);
    await owner
      .insert(setting)
      .values({ scopeKind: "workspace", scopeId: B, key: "lightRuns", value: "on" });
    root = await issue(`op-root-${tag}`, { isRoot: true, role: "owner" });
    bOwner = await issue(GONE, { isRoot: false, role: "owner", workspaceId: B });
    member = await issue(KEEP, { isAdmin: false, isRoot: false, role: "member", workspaceId: A });
  });

  afterAll(async () => {
    await owner.execute(sql`delete from zetta.usage_counter where workspace_id in (${A}, ${B})`);
    await owner.execute(sql`delete from zetta.workspace_quota where workspace_id in (${A}, ${B})`);
    await dropTestWorkspaces(owner, [A, B]);
    await owner.execute(sql`delete from zetta.workspace where id in (${A}, ${B})`);
    await cleanupTestUsers(owner, [KEEP, GONE]);
    await db.$client.end();
    await owner.$client.end();
  });

  test("root sees every workspace with its people and what it used; nobody else does", async () => {
    const all = await operator.list(root);
    const mine = all.filter((w) => w.id === A || w.id === B);
    expect(mine.map((w) => [w.name, w.people, w.status]).sort()).toEqual([
      ["Goes", 1, "active"],
      ["Keeps", 1, "active"],
    ]);
    expect(mine[0]!.usage).toEqual({ runs: 0, runSeconds: 0 });
    await expect(operator.list(member)).rejects.toBeInstanceOf(AccessError);
    await expect(operator.list(bOwner)).rejects.toBeInstanceOf(AccessError);
  });

  test("a workspace that used what root gives it runs nothing more this month; the others go on", async () => {
    await operator.setQuota(root, B, { runsPerMonth: 1, runSecondsPerMonth: null });
    await quotas.meter.admit(B);
    await quotas.meter.record(B, 1500);
    expect(await quotas.usage(B)).toEqual({ runs: 1, runSeconds: 2 });
    const refused = await quotas.meter.admit(B).then(
      () => "ran",
      (e) => (e instanceof HarnessError ? e.code : String(e)),
    );
    expect(refused).toBe("workspace_quota");
    await quotas.meter.admit(A);
    // No limit again.
    await operator.setQuota(root, B, { runsPerMonth: null, runSecondsPerMonth: null });
    await quotas.meter.admit(B);
    await expect(
      operator.setQuota(member, B, { runsPerMonth: 1, runSecondsPerMonth: null }),
    ).rejects.toBeInstanceOf(AccessError);
  });

  test("a suspended workspace has nobody in it until it runs again", async () => {
    await operator.setStatus(root, B, "suspended");
    expect(await lookup(GONE, B)).toBeNull();
    await operator.setStatus(root, B, "active");
    expect((await lookup(GONE, B))?.workspaceId).toBe(B);
  });

  test("a copy holds every row of its own workspace and nothing of another, and no secret", async () => {
    await expect(operator.export(member, B)).rejects.toBeInstanceOf(AccessError);
    const copy = await operator.export(bOwner, B);
    expect(copy.name).toEndWith(".ndjson.gz");
    const text = gunzipSync(Buffer.from(await new Response(copy.body).arrayBuffer())).toString(
      "utf8",
    );
    const lines = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { table?: string; row?: { workspace_id: string } });
    const rows = lines.filter((l) => l.table);
    expect(rows.length).toBe(await count(B));
    expect(rows.every((l) => l.row!.workspace_id === B)).toBe(true);
    expect(new Set(rows.map((l) => l.table))).toEqual(
      new Set(["bot", "bot_revision", "folder", "team", "team_member", "conversation", "message"]),
    );
    expect(lines.some((l) => l.table === "connection_credential")).toBe(false);
    expect(audits.some((a) => a.includes(`${B} exported`))).toBe(true);
  });

  test("deleting a workspace removes everything in it and nothing of another; root's own is never deleted", async () => {
    const before = await count(A);
    expect(await count(B)).toBeGreaterThan(5);
    await expect(operator.remove(bOwner, B)).rejects.toBeInstanceOf(AccessError);
    await operator.remove(root, B);
    expect(await count(B)).toBe(0);
    expect(await count(A)).toBe(before);
    const [tomb] = await owner.select().from(workspace).where(eq(workspace.id, B));
    expect(tomb?.status).toBe("deleted");
    // Its people stay on record, removed: they stand nowhere.
    expect(
      (await owner.select().from(workspaceMember).where(eq(workspaceMember.workspaceId, B))).map(
        (m) => m.status,
      ),
    ).toEqual(["removed"]);
    expect(
      await owner.select().from(invitationGrant).where(eq(invitationGrant.workspaceId, B)),
    ).toEqual([]);
    expect(
      await owner
        .select()
        .from(setting)
        .where(inArray(setting.scopeId, [B])),
    ).toEqual([]);
    expect(await lookup(GONE, B)).toBeNull();
    // Its owner still signs in, and stands in no workspace: their requests see nothing, never the first workspace's rows.
    const access = createIdentityAccess(
      { api: { getSession: async ({ headers }) => ({ user: { id: headers.get("x-user")! } }) } },
      lookup,
    );
    const seen = await tenant.open(async () => {
      const who = await access.requireActive(new Headers({ "x-user": GONE }));
      return {
        workspace: who.workspaceId,
        bots: (await db.select({ id: bot.id }).from(bot)).length,
      };
    });
    expect(seen).toEqual({ workspace: undefined, bots: 0 });
    // Gone from root's list; and root's own workspace is refused.
    expect((await operator.list(root)).some((w) => w.id === B)).toBe(false);
    const own = (await operator.list(root)).find((w) => w.own)!;
    await expect(operator.remove(root, own.id)).rejects.toThrow("cannot be deleted");
  });
});

// The wall between workspaces (docs/decisions/workspaces.md, "RLS" and "Verification"). Every query of the app runs as `zetta_app`, set
// by the pool to the workspace of the work that asked (packages/db/src/index.ts and tenant.ts). These tests go through that pool.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb, tenant } from "@zetta/db";
import { and, eq, inArray, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, botRevision, folder } from "@zetta/db/schema/chat";
import { team } from "@zetta/db/schema/teams";
import { phoneNumber } from "@zetta/db/schema/phone";
import { workspace } from "@zetta/db/schema/workspaces";
import { cleanupTestUsers, dropTestWorkspaces } from "../../test-support/db-cleanup";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Tables that every workspace shares, with no `workspace_id` and no rule: people and their sign-in, the server's own settings and keys,
 * what places a person in a workspace, and what is a person's own across workspaces (their preferences, their key that seals secrets,
 * their devices' push addresses). A new table is on this list on purpose, or it carries the wall.
 */
const SHARED = new Set([
  "account",
  "connection_key_check",
  "connection_nonce",
  "connection_user_key",
  "dispatch_capacity",
  "dispatch_claims",
  "dispatch_grants",
  "identity_audit",
  "installation_identity",
  "installation_settings",
  "invitation",
  "invitation_grant",
  "jwks",
  "membership",
  "oauth_access_token",
  "oauth_client",
  "oauth_client_assertion",
  "oauth_client_resource",
  "oauth_consent",
  "oauth_refresh_token",
  "oauth_resource",
  "phone_optout",
  "phone_webhook_event",
  "push_subscription",
  "rate_limit",
  "run_attempts",
  "runs",
  "server_instance",
  "session",
  "setting",
  "transport_key",
  "usage_counter",
  "user",
  "user_preference",
  "verification",
  "workspace",
  "workspace_member",
  "workspace_quota",
]);
/** Shared tables that name a workspace without belonging to it: who is in it, what an invitation joins, what it may use and used. */
const NAMES_A_WORKSPACE = [
  "invitation_grant",
  "usage_counter",
  "workspace_member",
  "workspace_quota",
];

suite("the wall between workspaces", () => {
  // The app's pool, held by the wall; and the login's, for what a test sets up and checks from outside it.
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const owner = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never, {
    wall: "off",
  });
  const tag = uuidv7().slice(-8);
  const ANA = `wall-ana-${tag}`;
  const BO = `wall-bo-${tag}`;
  const A = uuidv7();
  const B = uuidv7();
  let botA = "";
  let botB = "";

  beforeAll(async () => {
    const now = new Date();
    await owner.insert(user).values(
      [ANA, BO].map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await owner.insert(workspace).values([
      { id: A, slug: `wall-a-${tag}`, name: "A" },
      { id: B, slug: `wall-b-${tag}`, name: "B" },
    ]);
    // The same names in both workspaces: a name is a workspace's own.
    const make = (workspaceId: string, ownerUserId: string) =>
      tenant.run(workspaceId, async () => {
        const [row] = await db
          .insert(bot)
          .values({
            ownerUserId,
            kind: "specialist",
            visibility: "team",
            name: "Support",
            slug: `support-${tag}`,
            harness: "claude-code",
          })
          .returning({ id: bot.id, workspaceId: bot.workspaceId });
        await db.insert(team).values({ ownerUserId, name: `Ops ${tag}` });
        await db.insert(folder).values({ ownerUserId, name: `Notes ${tag}` });
        return row!;
      });
    const a = await make(A, ANA);
    const b = await make(B, BO);
    expect(a.workspaceId).toBe(A);
    expect(b.workspaceId).toBe(B);
    botA = a.id;
    botB = b.id;
  });

  afterAll(async () => {
    await dropTestWorkspaces(owner, [A, B]);
    await cleanupTestUsers(owner, [ANA, BO]);
    await db.$client.end();
    await owner.$client.end();
  });

  test("every table carries the wall, or is on the list of what all workspaces share", async () => {
    const tables = await owner.execute<{
      name: string;
      column: boolean;
      required: boolean;
      on: boolean;
      forced: boolean;
      rule: boolean;
    }>(sql`
      select c.relname as name,
        exists (select 1 from information_schema.columns k where k.table_schema = 'zetta' and k.table_name = c.relname and k.column_name = 'workspace_id') as column,
        exists (select 1 from information_schema.columns k where k.table_schema = 'zetta' and k.table_name = c.relname and k.column_name = 'workspace_id' and k.is_nullable = 'NO') as required,
        c.relrowsecurity as on, c.relforcerowsecurity as forced,
        exists (select 1 from pg_policies p where p.schemaname = 'zetta' and p.tablename = c.relname and p.policyname = 'workspace_wall') as rule
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'zetta' and c.relkind = 'r'
      order by 1`);
    const wrong = tables.rows
      .filter((t) =>
        SHARED.has(t.name)
          ? t.on || (t.column && !NAMES_A_WORKSPACE.includes(t.name))
          : !(t.required && t.on && t.forced && t.rule),
      )
      .map((t) => t.name);
    expect(wrong).toEqual([]);
    // The list names only tables that exist.
    const names = new Set(tables.rows.map((t) => t.name));
    expect([...SHARED].filter((name) => !names.has(name))).toEqual([]);
  });

  test("the app runs as a role the wall holds, whatever the login is", async () => {
    const [who] = (
      await db.execute<{ role: string; superuser: boolean; bypass: boolean }>(
        sql`select current_user as role, rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user`,
      )
    ).rows;
    expect(who).toEqual({ role: "zetta_app", superuser: false, bypass: false });
  });

  test("each workspace sees its own rows only, and none at all with no workspace", async () => {
    const bots = (workspaceId?: string) => {
      const read = () =>
        db
          .select({ id: bot.id })
          .from(bot)
          .where(inArray(bot.id, [botA, botB]));
      return (workspaceId ? tenant.run(workspaceId, read) : tenant.open(read)).then((rows) =>
        rows.map((r) => r.id),
      );
    };
    expect(await bots(A)).toEqual([botA]);
    expect(await bots(B)).toEqual([botB]);
    // A request before its person is known runs where work with none runs: not in A or B.
    expect(await bots()).toEqual([]);
    // Raw SQL is held the same way.
    const raw = await tenant.run(A, () =>
      db.execute<{ n: number }>(
        sql`select count(*)::int as n from bot where id in (${botA}, ${botB})`,
      ),
    );
    expect(raw.rows[0]!.n).toBe(1);
  });

  test("a workspace cannot write into another, nor change or delete its rows", async () => {
    const intoB = await tenant
      .run(A, () =>
        db.insert(folder).values({ workspaceId: B, ownerUserId: ANA, name: `Sneaky ${tag}` }),
      )
      .then(
        () => "written",
        (e) =>
          (e as { cause?: { code?: string }; code?: string }).cause?.code ??
          (e as { code?: string }).code,
      );
    expect(intoB).toBe("42501");
    const renamed = await tenant.run(A, () =>
      db.update(bot).set({ name: "Taken" }).where(eq(bot.id, botB)).returning({ id: bot.id }),
    );
    expect(renamed).toEqual([]);
    const deleted = await tenant.run(A, () =>
      db.delete(bot).where(eq(bot.id, botB)).returning({ id: bot.id }),
    );
    expect(deleted).toEqual([]);
    // Moving a row of its own into another workspace is refused too.
    const moved = await tenant
      .run(A, () => db.update(bot).set({ workspaceId: B }).where(eq(bot.id, botA)))
      .then(
        () => "moved",
        (e) =>
          (e as { cause?: { code?: string }; code?: string }).cause?.code ??
          (e as { code?: string }).code,
      );
    expect(moved).toBe("42501");
    const [still] = await owner.select().from(bot).where(eq(bot.id, botB));
    expect(still?.name).toBe("Support");
  });

  test("a row of one workspace cannot point at a row of another", async () => {
    // From outside the wall, where nothing else would stop it: the same-workspace key does.
    const failed = await owner
      .insert(botRevision)
      .values({ workspaceId: A, botId: botB, version: 1, config: {}, changedByUserId: ANA })
      .then(
        () => "written",
        (e) =>
          (e as { cause?: { code?: string }; code?: string }).cause?.code ??
          (e as { code?: string }).code,
      );
    expect(failed).toBe("23503");
  });

  test("what arrives from outside is routed across workspaces by reading the routing tables only", async () => {
    const e164 = `+1555${String(Date.now()).slice(-7)}`;
    await tenant.run(B, () =>
      db.insert(phoneNumber).values({
        ownerUserId: BO,
        botId: botB,
        e164,
        country: "US",
        provider: "telnyx",
        status: "active",
      } as never),
    );
    const found = await tenant.scan(() =>
      db
        .select({ workspaceId: phoneNumber.workspaceId })
        .from(phoneNumber)
        .where(eq(phoneNumber.e164, e164)),
    );
    expect(found).toEqual([{ workspaceId: B }]);
    // The same reading sees nothing of a table that is not for routing, and writes nothing.
    expect(
      await tenant.scan(() =>
        db
          .select({ id: bot.id })
          .from(bot)
          .where(inArray(bot.id, [botA, botB])),
      ),
    ).toEqual([]);
    const wrote = await tenant
      .scan(() =>
        db
          .update(phoneNumber)
          .set({ status: "released" })
          .where(eq(phoneNumber.e164, e164))
          .returning({ id: phoneNumber.id }),
      )
      .then(
        (rows) => rows.length,
        () => "refused",
      );
    expect(wrote === 0 || wrote === "refused").toBe(true);
    await tenant.run(B, () =>
      db
        .delete(phoneNumber)
        .where(and(eq(phoneNumber.e164, e164), eq(phoneNumber.ownerUserId, BO))),
    );
  });
});

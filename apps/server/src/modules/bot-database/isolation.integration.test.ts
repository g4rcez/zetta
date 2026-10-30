import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { PluginError } from "../integrations/plugins/registry";
import { insertWithSlug } from "./allocate";
import { botDatabasePlugin, configureBotDatabase } from "./plugin";
import { createBotDatabase, type BotDatabase } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const OWNER = `botdb-${uuidv7()}`;
const tag = () =>
  `x${uuidv7()
    .replace(/[^a-z]/g, "")
    .slice(-6)}`;

/**
 * Proof that a bot's database is its own and nothing else: every statement below runs on a connection logged in as the bot's role.
 * Needs a migrated test database whose user may create roles (the compose postgres superuser does).
 */
suite("bot database isolation against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const cfg = { databaseUrl: url ?? "", key: "test-key-0123456789abcdef0123456789abcdef" };
  let svc: BotDatabase;
  let a: string, b: string, schemaA: string, schemaB: string;
  const code = async (p: Promise<unknown>) =>
    p.then(
      () => "ok",
      (e) => (e instanceof PluginError ? e.code : `raw:${(e as { code?: string }).code}`),
    );
  const mk = (name: string) =>
    insertWithSlug(
      db,
      name,
      async (slug) =>
        (
          await db
            .insert(bot)
            .values({
              ownerUserId: OWNER,
              name,
              slug,
              kind: "specialist",
              visibility: "private",
              harness: "fixture",
            })
            .returning()
        )[0]!,
    );

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: OWNER,
      name: OWNER,
      email: `${OWNER}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const t = tag();
    a = (await mk(`Iso ${t} A`)).id;
    b = (await mk(`Iso ${t} B`)).id;
    svc = createBotDatabase(db, cfg);
    schemaA = await svc.ensure(a);
    schemaB = await svc.ensure(b);
  });
  afterAll(async () => {
    await svc?.close();
    await cleanupTestUsers(db, [OWNER]);
    await db.$client.end();
  });

  test("slugs are unique and the schema is their snake_case plus _bot", async () => {
    const t = tag();
    const one = await mk(`Choquei ${t}`);
    const two = await mk(`Choquei ${t}`);
    expect(one.slug).toBe(`choquei-${t}`);
    expect(two.slug).toBe(`choquei-${t}-2`);
    expect(schemaA).toMatch(/^iso_x[a-z]+_a_bot$/);
  });

  test("the database is available to the bot's owner only, not to a teammate who talks to the bot", async () => {
    configureBotDatabase(svc);
    const always = botDatabasePlugin.always!;
    expect(await always.available(a, OWNER)).toBe(true);
    expect(await always.available(a, "someone-else")).toBe(false);
    configureBotDatabase(undefined);
  });

  test("a bot creates, writes and reads its own tables", async () => {
    await svc.execute(
      a,
      "create table notes (id int primary key, body text); comment on table notes is 'Notes: things to keep'; insert into notes values (1, 'hello')",
    );
    expect((await svc.query(a, "select body from notes where id = $1", [1])).rows).toEqual([
      { body: "hello" },
    ]);
    const o = await svc.overview(a);
    expect(o.tables.map((t) => [t.name, t.description, t.rows])).toEqual([
      ["notes", "Notes: things to keep", 1],
    ]);
  });

  test("everything outside its own schema is refused by Postgres", async () => {
    await svc.execute(b, "create table secrets (v text); insert into secrets values ('b only')");
    const forbidden: [string, () => Promise<unknown>][] = [
      ['select * from public."user"', () => svc.query(a, 'select * from public."user"')],
      ["select * from public.bot", () => svc.query(a, "select * from public.bot")],
      [
        `select * from "${schemaB}".secrets`,
        () => svc.query(a, `select * from "${schemaB}".secrets`),
      ],
      [
        "select * from drizzle.__drizzle_migrations",
        () => svc.query(a, "select * from drizzle.__drizzle_migrations"),
      ],
      [
        "select pg_read_file('/etc/hostname')",
        () => svc.query(a, "select pg_read_file('/etc/hostname')"),
      ],
      [
        "create table public.planted (i int)",
        () => svc.execute(a, "create table public.planted (i int)"),
      ],
      [`set role "${schemaB}"`, () => svc.execute(a, `set role "${schemaB}"`)],
      ["set role postgres", () => svc.execute(a, "set role postgres")],
      ["create schema planted_bot", () => svc.execute(a, "create schema planted_bot")],
      ["create temp table t (i int)", () => svc.execute(a, "create temp table t (i int)")],
      [
        `drop schema "${schemaA}" cascade`,
        () => svc.execute(a, `drop schema "${schemaA}" cascade`),
      ],
      [
        `alter role "${schemaB}" connection limit 50`,
        () => svc.execute(a, `alter role "${schemaB}" connection limit 50`),
      ],
    ];
    for (const [sql, run] of forbidden)
      expect([sql, await code(run())]).toEqual([sql, "DB_FORBIDDEN"]);
    // Re-granting its schema is a no-op (Postgres only warns: the bot holds no grant option), so B still cannot look inside A.
    await svc.execute(
      a,
      `grant usage on schema "${schemaA}" to public; grant select on notes to public`,
    );
    expect(await code(svc.query(b, `select * from "${schemaA}".notes`))).toBe("DB_FORBIDDEN");
    expect(await code(svc.execute(a, "create extension if not exists pgcrypto"))).not.toBe("ok");
    expect((await svc.query(b, "select v from secrets")).rows).toEqual([{ v: "b only" }]);
  });

  test("reads cannot write and run one statement only", async () => {
    expect(await code(svc.query(a, "insert into notes values (2, 'x')"))).toBe("DB_READ_ONLY");
    expect(await code(svc.query(a, "select 1; drop table notes"))).toBe("DB_SYNTAX");
    expect((await svc.query(a, "select count(*)::int as n from notes")).rows).toEqual([{ n: 1 }]);
  });

  test("a bot that changes its own password or settings is repaired on the next connection", async () => {
    await svc.execute(
      a,
      `alter role "${schemaA}" password 'chosen-by-the-bot'; alter role "${schemaA}" set statement_timeout = 0`,
    );
    await svc.close(); // drop pooled connections so the next call must log in again
    expect(
      (await svc.query(a, "select current_setting('statement_timeout') as t")).rows[0],
    ).toBeDefined();
    const fresh = createBotDatabase(db, cfg); // a restarted server re-provisions too
    expect((await fresh.query(a, "select body from notes")).rows).toEqual([{ body: "hello" }]);
    await fresh.close();
  });

  test("a runaway statement is cancelled from outside, even with its timeout lifted", async () => {
    const fast = createBotDatabase(db, { ...cfg, timeoutMs: 1500 });
    const t0 = Date.now();
    expect(await code(fast.execute(a, "set statement_timeout = 0; select pg_sleep(20)"))).toBe(
      "TIMEOUT",
    );
    expect(Date.now() - t0).toBeLessThan(6000);
    await fast.close();
  });

  test("writes stop at the quota", async () => {
    const small = createBotDatabase(db, { ...cfg, quotaMb: 0.05 });
    await small.execute(
      b,
      "create table blob (v text); insert into blob select repeat(md5(g::text), 40) from generate_series(1, 400) g",
    );
    expect(await code(small.execute(b, "insert into blob values ('more')"))).toBe("QUOTA");
    expect((await small.query(b, "select count(*)::int as n from blob")).rows).toEqual([
      { n: 400 },
    ]); // reads still work
    await small.close();
  });

  test("templates, export and start over", async () => {
    await svc.applyTemplate(a, "tasks");
    await svc.applyTemplate(a, "tasks"); // idempotent
    await svc.execute(a, "insert into tasks (title) values ($1)", ['buy milk, "fresh"']);
    expect((await svc.overview(a)).templates).toEqual(["tasks"]);
    expect((await svc.exportCsv(a, "tasks")).csv).toContain('"buy milk, ""fresh"""');
    expect(Object.keys((await svc.exportJson(a)).tables).sort()).toEqual(["notes", "tasks"]);
    expect(await code(svc.rows(a, "pg_class"))).toBe("DB_NOT_FOUND");
    await svc.reset(a);
    const o = await svc.overview(a);
    expect([o.tables.length, o.templates.length]).toEqual([0, 0]);
  });

  test("the built-in plugin frames rows as untrusted and honours the owner's switch", async () => {
    configureBotDatabase(svc);
    const tool = (n: string) => botDatabasePlugin.tools!.find((t) => t.name === n)!;
    const ctx = { userId: OWNER, botId: b, config: {}, setConfig: async () => {} };
    const out = String(await tool("db_query").handler(ctx, { sql: "select v from secrets" }));
    expect(out).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(out).toContain("b only");
    expect(await botDatabasePlugin.always!.available(b)).toBe(true);
    expect(await botDatabasePlugin.always!.prompt!(b)).toContain(schemaB);
    await svc.setAccess(b, false);
    expect(await botDatabasePlugin.always!.available(b)).toBe(false);
    configureBotDatabase(undefined);
  });
});

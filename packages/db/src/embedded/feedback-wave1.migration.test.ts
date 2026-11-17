// The `feedback_wave1` migration, run on a database shaped like the one before it: seeded rows must survive, bots with one seat get a role,
// everyone who existed keeps the full view, and a new person starts simple.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "feedback_wave1";
const real = existsSync(checkoutArchive()) ? test : test.skip;

const home = mkdtempSync(process.platform === "win32" ? join(tmpdir(), "zpg-") : "/tmp/zpg-");
const stops: (() => void)[] = [];
afterAll(() => {
  for (const stop of stops.reverse()) stop();
  rmSync(home, { recursive: true, force: true });
});

const run = async (url: string, text: string, params: unknown[] = []) => {
  const client = new Client({ connectionString: url, options: "-c search_path=zetta" });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
};

real(
  "feedback_wave1 keeps what exists and moves new people to the simple view",
  async () => {
    const all = migrationNames(checkoutMigrations());
    const target = all.find((name) => name.endsWith(`_${MIGRATION}`))!;
    // Later migrations may exist: this test stops at its own.
    const copy = (folder: string, names: string[]) => {
      mkdirSync(folder, { recursive: true });
      for (const name of names)
        cpSync(join(checkoutMigrations(), name), join(folder, name), { recursive: true });
    };
    const older = join(home, "older-migrations");
    const through = join(home, "through-migrations");
    copy(
      older,
      all.filter((n) => n < target),
    );
    copy(
      through,
      all.filter((n) => n <= target),
    );

    const before = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: older },
      "process",
    );
    stops.push(before.stop);
    const url = before.url;

    // The old shape: no new column exists yet, and the default is still `full`.
    const [old] = await run(
      url,
      `select (select column_default from information_schema.columns where table_schema = 'zetta' and table_name = 'user_preference' and column_name = 'nav_mode') as nav_default,
              (select count(*)::int from information_schema.columns where table_schema = 'zetta' and table_name = 'bot' and column_name = 'role') as has_role`,
    );
    expect(old).toEqual({ nav_default: "'full'::text", has_role: 0 });

    for (const id of ["u-none", "u-pref", "u-simple"])
      await run(
        url,
        `insert into "user" (id, name, email) values ($1, $1, $1 || '@example.invalid')`,
        [id],
      );
    // One person changed a setting (so the row exists, with the column default), one chose simple on purpose.
    await run(
      url,
      `insert into user_preference (owner_user_id, rail_mode) values ('u-pref', 'collapsed')`,
    );
    await run(
      url,
      `insert into user_preference (owner_user_id, nav_mode) values ('u-simple', 'simple')`,
    );

    const bot = (slug: string) =>
      run(
        url,
        `insert into bot (owner_user_id, kind, visibility, name, slug) values ('u-none', 'specialist', 'private', $1, $1) returning id`,
        [slug],
      ).then((rows) => rows[0].id as string);
    const ids = await Promise.all(["one-seat", "two-seats", "no-seat", "long-title"].map(bot));
    const [one, two, none, long] = ids as [string, string, string, string];

    const [{ id: chart }] = await run(url, `insert into org_chart default values returning id`);
    const [{ id: root }] = await run(
      url,
      `insert into org_position (chart_id, rank, title) values ($1, 'ceo', 'CEO') returning id`,
      [chart],
    );
    const seat = (title: string, botId: string) =>
      run(
        url,
        `insert into org_position (chart_id, parent_id, title, seat, bot_id) values ($1, $2, $3, 'bot', $4)`,
        [chart, root, title, botId],
      );
    await seat("  Support lead  ", one);
    await seat("Writer", two);
    await seat("Reviewer", two);
    const longTitle = "x".repeat(75);
    await seat(longTitle, long);

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);

    const roles = new Map(
      (await run(url, `select id, role from bot`)).map((r) => [r.id as string, r.role as string]),
    );
    expect(roles.get(one)).toBe("Support lead");
    expect(roles.get(two)).toBe("");
    expect(roles.get(none)).toBe("");
    expect(roles.get(long)).toBe("x".repeat(60));

    const nav = new Map(
      (await run(url, `select owner_user_id, nav_mode, rail_mode from user_preference`)).map(
        (r) => [r.owner_user_id as string, r],
      ),
    );
    expect(nav.get("u-none")).toMatchObject({ nav_mode: "full", rail_mode: "expanded" });
    expect(nav.get("u-pref")).toMatchObject({ nav_mode: "full", rail_mode: "collapsed" });
    expect(nav.get("u-simple")).toMatchObject({ nav_mode: "simple" });

    // A person who signs up after the migration starts simple, with empty profile lines.
    await run(
      url,
      `insert into "user" (id, name, email) values ('u-new', 'New', 'new@example.invalid')`,
    );
    await run(url, `insert into user_preference (owner_user_id) values ('u-new')`);
    expect(
      await run(
        url,
        `select nav_mode, job_title, department, about, timezone, contact from user_preference where owner_user_id = 'u-new'`,
      ),
    ).toEqual([
      { nav_mode: "simple", job_title: "", department: "", about: "", timezone: "", contact: "" },
    ]);

    // The other new columns exist with their defaults, and the limits hold.
    const [defaults] = await run(
      url,
      `select (select column_default from information_schema.columns where table_schema = 'zetta' and table_name = 'installation_settings' and column_name = 'update_check') as update_check,
              (select count(*)::int from message where edited_at is not null) as edited,
              (select count(*)::int from message_revision) as revisions`,
    );
    expect(defaults).toEqual({ update_check: "'on'::text", edited: 0, revisions: 0 });
    await expect(
      run(url, `update bot set role = repeat('x', 61) where id = $1`, [one]),
    ).rejects.toThrow(/bot_role_check/);
    await expect(
      run(
        url,
        `update user_preference set job_title = repeat('x', 81) where owner_user_id = 'u-new'`,
      ),
    ).rejects.toThrow(/user_preference_job_title_check/);
  },
  240_000,
);

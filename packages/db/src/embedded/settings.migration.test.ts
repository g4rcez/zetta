// The `settings` migration, run on a database that already holds an installation row and a user: they stay as they are, and the new
// `setting` table keeps one value per key and scope (a null scope counts as one scope), refuses a scope id on the installation scope and
// none on a workspace.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "settings";
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
  "settings adds the setting table: one row per key and scope, the installation scope included, and existing rows stay",
  async () => {
    const all = migrationNames(checkoutMigrations());
    const target = all.find((name) => name.endsWith(`_${MIGRATION}`))!;
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
    await run(
      url,
      `insert into "user" (id, name, email) values ('u-one', 'u-one', 'u-one@example.invalid')`,
    );
    await run(
      url,
      `insert into installation_settings (id, network_mode, laya) values (1, 'local', 'off')`,
    );
    await expect(run(url, `select * from setting`)).rejects.toThrow(/setting/);

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);

    expect(await run(url, `select id, network_mode, laya from installation_settings`)).toEqual([
      { id: 1, network_mode: "local", laya: "off" },
    ]);
    expect(await run(url, `select id from "user"`)).toEqual([{ id: "u-one" }]);
    expect(await run(url, `select count(*)::int as n from setting`)).toEqual([{ n: 0 }]);

    const workspaceA = "0192f3a0-0000-7000-8000-00000000000a";
    const workspaceB = "0192f3a0-0000-7000-8000-00000000000b";
    // An installation value, and an organization's own value of the same key, are two rows.
    await run(
      url,
      `insert into setting (scope_kind, scope_id, key, value) values ('installation', null, 'harnessMax', '12'::jsonb)`,
    );
    await run(
      url,
      `insert into setting (scope_kind, scope_id, key, value, updated_by) values ('workspace', $1, 'harnessMax', '6'::jsonb, 'u-one')`,
      [workspaceA],
    );
    await run(
      url,
      `insert into setting (scope_kind, scope_id, key, value) values ('workspace', $1, 'harnessMax', '5'::jsonb)`,
      [workspaceB],
    );
    // The same key twice in the installation scope collides although `scope_id` is null (nulls not distinct)...
    await expect(
      run(
        url,
        `insert into setting (scope_kind, scope_id, key, value) values ('installation', null, 'harnessMax', '3'::jsonb)`,
      ),
    ).rejects.toThrow(/setting_scope_key_unique/);
    // ...and `on conflict do nothing` (the import for upgraders) keeps the first value.
    await run(
      url,
      `insert into setting (scope_kind, scope_id, key, value) values ('installation', null, 'harnessMax', '3'::jsonb) on conflict do nothing`,
    );
    await expect(
      run(
        url,
        `insert into setting (scope_kind, scope_id, key, value) values ('workspace', $1, 'harnessMax', '3'::jsonb)`,
        [workspaceA],
      ),
    ).rejects.toThrow(/setting_scope_key_unique/);
    expect(
      await run(
        url,
        `select scope_kind, key, value from setting where scope_id is null order by key`,
      ),
    ).toEqual([{ scope_kind: "installation", key: "harnessMax", value: 12 }]);
    expect(await run(url, `select count(*)::int as n from setting`)).toEqual([{ n: 3 }]);

    // The scope id is null exactly for the installation scope; the kind and the key length are checked.
    await expect(
      run(
        url,
        `insert into setting (scope_kind, scope_id, key, value) values ('installation', $1, 'lightRuns', '"on"'::jsonb)`,
        [workspaceA],
      ),
    ).rejects.toThrow(/setting_scope_id_check/);
    await expect(
      run(
        url,
        `insert into setting (scope_kind, scope_id, key, value) values ('workspace', null, 'lightRuns', '"on"'::jsonb)`,
      ),
    ).rejects.toThrow(/setting_scope_id_check/);
    await expect(
      run(
        url,
        `insert into setting (scope_kind, scope_id, key, value) values ('team', $1, 'lightRuns', '"on"'::jsonb)`,
        [workspaceA],
      ),
    ).rejects.toThrow(/setting_scope_kind_check/);
    await expect(
      run(
        url,
        `insert into setting (scope_kind, scope_id, key, value) values ('installation', null, $1, '"on"'::jsonb)`,
        ["k".repeat(65)],
      ),
    ).rejects.toThrow(/setting_key_check/);
    await expect(
      run(
        url,
        `insert into setting (scope_kind, scope_id, key, value) values ('installation', null, '', '"on"'::jsonb)`,
      ),
    ).rejects.toThrow(/setting_key_check/);
  },
);

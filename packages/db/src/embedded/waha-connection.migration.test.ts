// The `waha_connection` migration, run on a database that already holds an installation row with other sealed keys recorded: they stay as
// they are, the new column is empty (no WhatsApp server key), and it takes a connection id.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "waha_connection";
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
  "waha_connection adds a nullable key column and keeps the installation row and the other keys as they are",
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
    const mail = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    await run(
      url,
      `insert into installation_settings (id, mail_provider, mail_domain, mail_connection_id, phone_provider, phone_countries)
       values (1, 'resend', 'mail.example.invalid', $1, 'telnyx', 'US')`,
      [mail],
    );
    await expect(run(url, `select waha_connection_id from installation_settings`)).rejects.toThrow(
      /waha_connection_id/,
    );

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);

    expect(
      await run(
        url,
        `select mail_provider, mail_domain, mail_connection_id, phone_provider, waha_connection_id from installation_settings`,
      ),
    ).toEqual([
      {
        mail_provider: "resend",
        mail_domain: "mail.example.invalid",
        mail_connection_id: mail,
        phone_provider: "telnyx",
        waha_connection_id: null,
      },
    ]);
    // It records a connection id, and can be cleared again; there is no foreign key to satisfy.
    const waha = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
    await run(url, `update installation_settings set waha_connection_id = $1`, [waha]);
    expect(await run(url, `select waha_connection_id from installation_settings`)).toEqual([
      { waha_connection_id: waha },
    ]);
    await run(url, `update installation_settings set waha_connection_id = null`);
    expect(await run(url, `select waha_connection_id from installation_settings`)).toEqual([
      { waha_connection_id: null },
    ]);
  },
);

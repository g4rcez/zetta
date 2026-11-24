// The `phone_twilio` migration, run on a database that already holds an installation with Telnyx set up and a Telnyx number: both stay as
// they are (Telnyx still on, Twilio off, the default provider Telnyx), and a number may now belong to Twilio.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "phone_twilio";
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
  "phone_twilio adds the Twilio settings and lets a number belong to Twilio, keeping Telnyx rows as they are",
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
    const [{ id: botId }] = await run(
      url,
      `insert into bot (owner_user_id, kind, visibility, name, slug) values ('u-one', 'specialist', 'private', 'a', 'a') returning id`,
    );
    await run(
      url,
      `insert into installation_settings (id, phone_provider, phone_public_key, phone_public_url, phone_application_id, phone_request_mode, phone_countries)
       values (1, 'telnyx', 'pub', 'https://zetta.example.invalid', 'app-1', 'owner_request', 'US')`,
    );
    const [{ id: numberId }] = await run(
      url,
      `insert into phone_number (owner_user_id, bot_id, e164, provider, country, status) values ('u-one', $1, '+12025550101', 'telnyx', 'US', 'active') returning id`,
      [botId],
    );
    await expect(run(url, `select phone_twilio from installation_settings`)).rejects.toThrow(
      /phone_twilio/,
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
        `select phone_provider, phone_public_key, phone_application_id, phone_twilio, phone_twilio_account_sid, phone_twilio_connection_id, phone_default_provider from installation_settings`,
      ),
    ).toEqual([
      {
        phone_provider: "telnyx",
        phone_public_key: "pub",
        phone_application_id: "app-1",
        phone_twilio: "off",
        phone_twilio_account_sid: "",
        phone_twilio_connection_id: null,
        phone_default_provider: "telnyx",
      },
    ]);
    expect(await run(url, `select provider, e164, status from phone_number`)).toEqual([
      { provider: "telnyx", e164: "+12025550101", status: "active" },
    ]);

    // A number of Twilio may be recorded now; an unknown provider is still refused.
    await run(url, `update phone_number set status = 'released' where id = $1`, [numberId]);
    await run(
      url,
      `insert into phone_number (owner_user_id, bot_id, e164, provider, country, status) values ('u-one', $1, '+14155550102', 'twilio', 'US', 'active')`,
      [botId],
    );
    await expect(
      run(
        url,
        `insert into phone_number (owner_user_id, bot_id, e164, provider, country, status) values ('u-one', $1, '+14155550103', 'vonage', 'US', 'released')`,
        [botId],
      ),
    ).rejects.toThrow(/phone_number_provider_check/);
    // The installation settings take the Twilio switch and refuse nonsense.
    await run(
      url,
      `update installation_settings set phone_twilio = 'on', phone_twilio_account_sid = $1, phone_default_provider = 'twilio'`,
      [`AC${"0".repeat(32)}`],
    );
    await expect(
      run(url, `update installation_settings set phone_twilio = 'maybe'`),
    ).rejects.toThrow(/installation_settings_phone_twilio_check/);
    await expect(
      run(url, `update installation_settings set phone_default_provider = 'vonage'`),
    ).rejects.toThrow(/installation_settings_phone_twilio_check/);
  },
);

// The `phone_numbers` migration, run on a database that already holds a person, a bot, a chat and a call: they stay as they are, the
// installation settings get their phone columns with safe defaults, and the number and do-not-call tables keep their rules.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "phone_numbers";
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
  "phone_numbers adds numbers and a do-not-call list and leaves the rows that exist alone",
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
    const tables = () =>
      run(
        url,
        `select table_name from information_schema.tables where table_schema = 'zetta'`,
      ).then((rows) => new Set(rows.map((r) => r.table_name as string)));
    expect((await tables()).has("phone_number")).toBe(false);

    // Rows that exist: a person, two bots, a chat, a web call and settings with a mail provider.
    await run(
      url,
      `insert into "user" (id, name, email) values ('u-one', 'u-one', 'u-one@example.invalid')`,
    );
    const bots: string[] = [];
    for (const slug of ["phone-a", "phone-b"])
      bots.push(
        (
          await run(
            url,
            `insert into bot (owner_user_id, kind, visibility, name, slug) values ('u-one', 'specialist', 'private', $1, $1) returning id`,
            [slug],
          )
        )[0].id,
      );
    const [{ id: chatId }] = await run(
      url,
      `insert into conversation (owner_user_id, bot_id) values ('u-one', $1) returning id`,
      [bots[0]],
    );
    const [{ id: callId }] = await run(
      url,
      `insert into voice_call (owner_user_id, bot_id, conversation_id) values ('u-one', $1, $2) returning id`,
      [bots[0], chatId],
    );
    await run(
      url,
      `insert into installation_settings (id, mail_provider, mail_domain) values (1, 'resend', 'mail.example.invalid')`,
    );

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);
    const have = await tables();
    expect(have.has("phone_number") && have.has("phone_optout")).toBe(true);

    // Nothing that existed changed; the settings row gets phone defaults (off, no countries, bounded limits).
    expect(await run(url, `select count(*)::int as n from voice_call`)).toEqual([{ n: 1 }]);
    expect(
      await run(
        url,
        `select mail_provider, phone_provider, phone_connection_id, phone_public_key, phone_public_url, phone_application_id, phone_request_mode, phone_countries, phone_max_numbers, phone_max_call_minutes, phone_daily_minutes_per_bot, phone_daily_calls_per_bot from installation_settings`,
      ),
    ).toEqual([
      {
        mail_provider: "resend",
        phone_provider: "off",
        phone_connection_id: null,
        phone_public_key: "",
        phone_public_url: "",
        phone_application_id: "",
        phone_request_mode: "off",
        phone_countries: "",
        phone_max_numbers: 5,
        phone_max_call_minutes: 30,
        phone_daily_minutes_per_bot: 60,
        phone_daily_calls_per_bot: 20,
      },
    ]);
    const setting = (col: string, value: unknown) =>
      run(url, `update installation_settings set ${col} = $1`, [value]);
    await expect(setting("phone_provider", "twilio")).rejects.toThrow(
      /installation_settings_phone_check/,
    );
    await expect(setting("phone_request_mode", "anyone")).rejects.toThrow(
      /installation_settings_phone_check/,
    );
    await expect(setting("phone_max_call_minutes", 0)).rejects.toThrow(
      /installation_settings_phone_limits_check/,
    );
    await expect(setting("phone_max_numbers", 1001)).rejects.toThrow(
      /installation_settings_phone_limits_check/,
    );
    await expect(setting("phone_public_url", "h".repeat(513))).rejects.toThrow(
      /installation_settings_phone_check/,
    );
    await setting("phone_provider", "telnyx");

    const number = (extra: Record<string, unknown> = {}) => {
      const row = { owner_user_id: "u-one", bot_id: bots[0], country: "US", ...extra };
      const cols = Object.keys(row);
      return run(
        url,
        `insert into phone_number (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        Object.values(row),
      );
    };

    // Defaults: a version 7 id, ordered and under review, only the owner may call, calls out allowed, no PIN.
    const [first] = await number({ e164: "+15550100123" });
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first).toMatchObject({
      provider: "telnyx",
      status: "pending_review",
      inbound: "owner_only",
      outbound: "on",
      owner_number: null,
      pin_hash: null,
      pin_failures: 0,
    });

    // The rules: one open number per bot, the digits are unique until released, closed lists and shapes.
    await expect(number({ e164: "+15550100124" })).rejects.toThrow(/phone_number_bot_open_key/);
    await expect(number({ bot_id: bots[1], e164: "+15550100123" })).rejects.toThrow(
      /phone_number_e164_key/,
    );
    const b = (extra: Record<string, unknown>) => number({ bot_id: bots[1], ...extra });
    await expect(b({ e164: "5550100125" })).rejects.toThrow(/phone_number_e164_check/);
    await expect(b({ e164: "+15550100125", status: "dreaming" })).rejects.toThrow(
      /phone_number_status_check/,
    );
    await expect(b({ e164: "+15550100125", inbound: "some" })).rejects.toThrow(
      /phone_number_inbound_check/,
    );
    await expect(b({ e164: "+15550100125", outbound: "maybe" })).rejects.toThrow(
      /phone_number_outbound_check/,
    );
    await expect(b({ e164: "+15550100125", country: "usa" })).rejects.toThrow(
      /phone_number_country_check/,
    );
    await expect(b({ e164: "+15550100125", owner_number: "123" })).rejects.toThrow(
      /phone_number_owner_number_check/,
    );
    await expect(b({ e164: "+15550100125", area_code: "ab" })).rejects.toThrow(
      /phone_number_area_check/,
    );
    await expect(b({ status: "active" })).rejects.toThrow(/phone_number_has_number_check/);
    // A request has no number yet; a released number frees its digits and its bot.
    await b({ status: "requested", country: "BR", area_code: "11" });
    await expect(b({ status: "requested" })).rejects.toThrow(/phone_number_bot_open_key/);
    await run(url, `delete from phone_number where bot_id = $1`, [bots[1]]);
    await run(
      url,
      `update phone_number set status = 'released', released_at = now() where id = $1`,
      [first.id],
    );
    await number({ e164: "+15550100123" });

    // A call points at a number; deleting the number keeps the call.
    const [open] = await run(url, `select id from phone_number where status <> 'released'`);
    await run(url, `update voice_call set number_id = $1 where id = $2`, [open.id, callId]);
    await expect(
      run(url, `update voice_call set number_id = $1 where id = $2`, [
        "00000000-0000-7000-8000-000000000000",
        callId,
      ]),
    ).rejects.toThrow(/voice_call_number_id_phone_number_id_fkey/);
    await expect(run(url, `delete from bot where id = $1`, [bots[0]])).rejects.toThrow();
    await run(url, `delete from phone_number where id = $1`, [open.id]);
    expect(await run(url, `select number_id from voice_call where id = $1`, [callId])).toEqual([
      { number_id: null },
    ]);

    // The do-not-call list: one row per number, closed reasons.
    await run(url, `insert into phone_optout (e164) values ('+15550100199')`);
    await expect(
      run(url, `insert into phone_optout (e164) values ('+15550100199')`),
    ).rejects.toThrow(/phone_optout_e164_key/);
    await expect(
      run(url, `insert into phone_optout (e164, reason) values ('+15550100198', 'spite')`),
    ).rejects.toThrow(/phone_optout_reason_check/);
    await expect(run(url, `insert into phone_optout (e164) values ('nope')`)).rejects.toThrow(
      /phone_optout_e164_check/,
    );
  },
  240_000,
);

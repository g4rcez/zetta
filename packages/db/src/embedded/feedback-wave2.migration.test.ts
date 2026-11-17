// The `feedback_wave2` migration, run on a database shaped like the one before it: rows that exist keep their values and get the new
// defaults, the new table cascades with its user, and the limits hold.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "feedback_wave2";
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

const columns = (url: string, table: string) =>
  run(
    url,
    `select column_name from information_schema.columns where table_schema = 'zetta' and table_name = $1`,
    [table],
  ).then((rows) => new Set(rows.map((r) => r.column_name as string)));

real(
  "feedback_wave2 adds speech, push and model-server settings without touching what exists",
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

    // The old shape: none of the new columns or the table exist.
    expect((await columns(url, "installation_settings")).has("speech_provider")).toBe(false);
    expect((await columns(url, "user_preference")).has("push_mode")).toBe(false);
    expect((await columns(url, "connection")).has("config_base_url")).toBe(false);
    expect((await columns(url, "connection")).has("config_model")).toBe(false);
    expect((await columns(url, "push_subscription")).size).toBe(0);

    // Existing rows: the installation row with a speech-to-text choice, two people (one with a preference row), and a sealed connection.
    await run(
      url,
      `insert into installation_settings (id, transcribe_provider, transcribe_model, transcribe_base_url) values (1, 'compatible', 'whisper-large', 'https://stt.example.invalid/v1')`,
    );
    for (const id of ["u-pref", "u-none"])
      await run(
        url,
        `insert into "user" (id, name, email) values ($1, $1, $1 || '@example.invalid')`,
        [id],
      );
    await run(
      url,
      `insert into user_preference (owner_user_id, rail_mode) values ('u-pref', 'collapsed')`,
    );
    const connectionId = "0192f000-0000-7000-8000-000000000001";
    await run(
      url,
      `insert into connection (id, owner_user_id, kind, provider, label, state, revision, created_at, updated_at, current_credential_version)
       values ($1, 'u-pref', 'api-key', 'openai', 'My key', 'active', 1, now(), now(), 1)`,
      [connectionId],
    );

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);

    // Installation: what was chosen stays, speech starts on the device's own voice, push has no keys yet.
    expect(await run(url, `select * from installation_settings where id = 1`)).toMatchObject([
      {
        transcribe_provider: "compatible",
        transcribe_model: "whisper-large",
        transcribe_base_url: "https://stt.example.invalid/v1",
        speech_provider: "browser",
        speech_base_url: "",
        speech_model: "",
        speech_voice: "",
        speech_language: "",
        speech_connection_id: null,
        push_public_key: null,
        push_connection_id: null,
      },
    ]);

    // People: the row that existed keeps its value and gets the default push choice; a new row gets it too.
    expect(
      await run(url, `select owner_user_id, rail_mode, push_mode from user_preference`),
    ).toEqual([
      { owner_user_id: "u-pref", rail_mode: "collapsed", push_mode: "mentions_and_approvals" },
    ]);
    await run(url, `insert into user_preference (owner_user_id) values ('u-none')`);
    expect(
      await run(url, `select push_mode from user_preference where owner_user_id = 'u-none'`),
    ).toEqual([{ push_mode: "mentions_and_approvals" }]);

    // The connection that existed has an empty config and is otherwise untouched.
    expect(
      await run(
        url,
        `select provider, label, state, config_base_url, config_model from connection where id = $1`,
        [connectionId],
      ),
    ).toEqual([
      {
        provider: "openai",
        label: "My key",
        state: "active",
        config_base_url: "",
        config_model: "",
      },
    ]);

    // The address and the model name are bounded text: 512 and 100 characters.
    await run(url, `update connection set config_base_url = $2, config_model = $3 where id = $1`, [
      connectionId,
      "http://127.0.0.1:11434/v1",
      "llama3.1:8b",
    ]);
    await expect(
      run(url, `update connection set config_base_url = repeat('x', 513) where id = $1`, [
        connectionId,
      ]),
    ).rejects.toThrow(/connection_config_check/);
    await expect(
      run(url, `update connection set config_model = repeat('x', 101) where id = $1`, [
        connectionId,
      ]),
    ).rejects.toThrow(/connection_config_check/);

    // Speech and push-key limits hold.
    await expect(
      run(url, `update installation_settings set speech_voice = repeat('x', 101) where id = 1`),
    ).rejects.toThrow(/installation_settings_speech_check/);
    await expect(
      run(url, `update installation_settings set push_public_key = '' where id = 1`),
    ).rejects.toThrow(/installation_settings_push_public_key_check/);

    // Push subscriptions: defaults, a unique endpoint, limits, and the cascade with the user.
    const insert = (user: string, endpoint: string, extra = "") =>
      run(
        url,
        `insert into push_subscription (user_id, endpoint, p256dh, auth ${extra ? ", user_agent" : ""})
         values ($1, $2, 'p256dh-key', 'auth-key' ${extra ? ", $3" : ""}) returning id, user_agent, created_at, last_used_at, failed_at`,
        extra ? [user, endpoint, extra] : [user, endpoint],
      );
    const [first] = await insert("u-pref", "https://push.example.invalid/one");
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first).toMatchObject({ user_agent: "", failed_at: null });
    expect(first.created_at).toBeInstanceOf(Date);
    expect(first.last_used_at).toBeInstanceOf(Date);
    await insert("u-pref", "https://push.example.invalid/two", "Safari on iPhone");
    await insert("u-none", "https://push.example.invalid/three");
    await expect(insert("u-none", "https://push.example.invalid/one")).rejects.toThrow(
      /push_subscription_endpoint_unique/,
    );
    await expect(insert("u-ghost", "https://push.example.invalid/four")).rejects.toThrow(
      /push_subscription_user_id_user_id_fkey/,
    );
    await expect(
      run(
        url,
        `insert into push_subscription (user_id, endpoint, p256dh, auth) values ('u-none', 'https://push.example.invalid/five', '', 'a')`,
      ),
    ).rejects.toThrow(/push_subscription_limits_check/);
    await expect(
      run(
        url,
        `insert into push_subscription (user_id, endpoint, p256dh, auth, user_agent) values ('u-none', 'https://push.example.invalid/six', 'p', 'a', repeat('x', 201))`,
      ),
    ).rejects.toThrow(/push_subscription_limits_check/);
    expect(
      await run(
        url,
        `select count(*)::int as n from pg_indexes where schemaname = 'zetta' and indexname = 'push_subscription_user_id_idx'`,
      ),
    ).toEqual([{ n: 1 }]);

    // Deleting a person deletes their subscriptions and nobody else's.
    const countFor = (id: string) =>
      run(url, `select count(*)::int as n from push_subscription where user_id = $1`, [id]);
    expect(await countFor("u-none")).toEqual([{ n: 1 }]);
    await run(url, `delete from user_preference where owner_user_id = 'u-none'`);
    await run(url, `delete from "user" where id = 'u-none'`);
    expect(await countFor("u-none")).toEqual([{ n: 0 }]);
    expect(await countFor("u-pref")).toEqual([{ n: 2 }]);
    // A person who still owns a connection cannot be deleted (as before this migration); the subscriptions wait with them.
    await expect(run(url, `delete from "user" where id = 'u-pref'`)).rejects.toThrow();
    expect(await countFor("u-pref")).toEqual([{ n: 2 }]);
    await run(url, `delete from connection where id = $1`, [connectionId]);
    await run(url, `delete from user_preference where owner_user_id = 'u-pref'`);
    await run(url, `delete from "user" where id = 'u-pref'`);
    expect(await countFor("u-pref")).toEqual([{ n: 0 }]);
  },
  240_000,
);

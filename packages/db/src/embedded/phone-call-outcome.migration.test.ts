// The `phone_call_outcome` migration, run on a database that already holds a person, a bot, a chat and a call: the old row stays as it is
// (no outcome, no asking chat), and a call may now carry one of the five outcomes and the chat that asked for it.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "phone_call_outcome";
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
  "phone_call_outcome adds the outcome and the asking chat to calls without touching old rows",
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
    const [{ id: chatId }] = await run(
      url,
      `insert into conversation (owner_user_id, bot_id) values ('u-one', $1) returning id`,
      [botId],
    );
    const [{ id: callId }] = await run(
      url,
      `insert into voice_call (owner_user_id, bot_id, conversation_id) values ('u-one', $1, $2) returning id`,
      [botId, chatId],
    );
    await expect(run(url, `select outcome from voice_call`)).rejects.toThrow(/outcome/);

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);

    expect(
      await run(url, `select outcome, requested_in from voice_call where id = $1`, [callId]),
    ).toEqual([{ outcome: null, requested_in: null }]);
    await run(
      url,
      `insert into voice_call (owner_user_id, bot_id, channel, direction, trust, status, end_reason, ended_at, outcome, requested_in) values ('u-one', $1, 'phone', 'out', 'outside', 'ended', 'hangup', now(), 'voicemail', $2)`,
      [botId, chatId],
    );
    await expect(
      run(
        url,
        `insert into voice_call (owner_user_id, bot_id, outcome) values ('u-one', $1, 'spoke')`,
        [botId],
      ),
    ).rejects.toThrow(/voice_call_outcome_check/);
    // Deleting the asking chat keeps the call row (and its call chat is not touched).
    await run(url, `delete from conversation where id = $1`, [chatId]);
    expect(
      await run(url, `select outcome, requested_in from voice_call where outcome is not null`),
    ).toEqual([{ outcome: "voicemail", requested_in: null }]);
  },
);

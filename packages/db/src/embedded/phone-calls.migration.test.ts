// The `phone_calls` migration, run on a database that already holds a person, a bot, a chat and a web call: they stay as they are, a call
// may now have no conversation (a phone call turned away), and the table of seen webhook ids exists with its rules.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "phone_calls";
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

real("phone_calls lets a call have no conversation and records seen webhook ids", async () => {
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
  // Before: a call without a conversation is refused.
  await expect(
    run(url, `insert into voice_call (owner_user_id, bot_id) values ('u-one', $1)`, [botId]),
  ).rejects.toThrow(/conversation_id/);

  const after = await startEmbeddedDatabase(
    home,
    { archive: checkoutArchive(), migrations: through },
    "process",
  );
  stops.push(after.stop);
  expect(after.url).toBe(url);

  // The call that existed keeps its conversation.
  expect(await run(url, `select conversation_id from voice_call where id = $1`, [callId])).toEqual([
    { conversation_id: chatId },
  ]);
  // A turned-away phone call has none; deleting the chat still deletes the calls of that chat only.
  await run(
    url,
    `insert into voice_call (owner_user_id, bot_id, channel, trust, status, end_reason, ended_at) values ('u-one', $1, 'phone', 'outside', 'blocked', 'refused', now())`,
    [botId],
  );
  await run(url, `delete from conversation where id = $1`, [chatId]);
  expect(await run(url, `select count(*)::int as n from voice_call`)).toEqual([{ n: 1 }]);

  // Seen webhook ids: one row per id, a bounded id, a time.
  await run(url, `insert into phone_webhook_event (event_id) values ('evt-1')`);
  await expect(
    run(url, `insert into phone_webhook_event (event_id) values ('evt-1')`),
  ).rejects.toThrow(/phone_webhook_event_pkey|duplicate/);
  await expect(run(url, `insert into phone_webhook_event (event_id) values ('')`)).rejects.toThrow(
    /phone_webhook_event_id_check/,
  );
  const [row] = await run(url, `select seen_at from phone_webhook_event`);
  expect(row.seen_at).toBeInstanceOf(Date);
});

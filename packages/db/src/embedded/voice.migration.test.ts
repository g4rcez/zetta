// The `voice` migration, run on a database that already holds a person, a bot and a chat: they stay as they are, the bot gets two empty
// voice columns, and the new call table keeps its rules (closed lists, an ended call says when, and what each reference does when the
// thing it points to goes).
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "voice";
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
  "voice adds a call table and two bot columns and leaves the rows that exist alone",
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
    expect((await tables()).has("voice_call")).toBe(false);

    // Rows that exist: two people, a bot and a chat.
    for (const id of ["u-one", "u-two"])
      await run(
        url,
        `insert into "user" (id, name, email) values ($1, $1, $1 || '@example.invalid')`,
        [id],
      );
    const [{ id: botId }] = await run(
      url,
      `insert into bot (owner_user_id, kind, visibility, name, slug) values ('u-one', 'specialist', 'private', 'Talker', 'talker-mig') returning id`,
    );
    const [{ id: chatId }] = await run(
      url,
      `insert into conversation (owner_user_id, bot_id) values ('u-one', $1) returning id`,
      [botId],
    );

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);
    expect((await tables()).has("voice_call")).toBe(true);

    // Nothing that existed changed, and the old bot has no voice of its own (the installation's applies).
    expect(await run(url, `select count(*)::int as n from "user"`)).toEqual([{ n: 2 }]);
    expect(
      await run(url, `select name, voice, voice_language from bot where id = $1`, [botId]),
    ).toEqual([{ name: "Talker", voice: null, voice_language: null }]);
    expect(await run(url, `select count(*)::int as n from conversation`)).toEqual([{ n: 1 }]);

    const call = (extra: Record<string, unknown> = {}) => {
      const cols = ["owner_user_id", "bot_id", "conversation_id", ...Object.keys(extra)];
      return run(
        url,
        `insert into voice_call (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        ["u-one", botId, chatId, ...Object.values(extra)],
      );
    };

    // Defaults: a version 7 id, a web call in, active, from the owner, nothing ended.
    const [first] = await call();
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first).toMatchObject({
      channel: "web",
      direction: "in",
      trust: "owner",
      status: "active",
      peer: null,
      number_id: null,
      end_reason: null,
      ended_at: null,
      owner_instance: null,
    });
    expect(first.started_at).toBeInstanceOf(Date);

    // The closed lists and the limits.
    await expect(call({ channel: "sms" })).rejects.toThrow(/voice_call_channel_check/);
    await expect(call({ direction: "sideways" })).rejects.toThrow(/voice_call_direction_check/);
    await expect(call({ trust: "friend" })).rejects.toThrow(/voice_call_trust_check/);
    await expect(call({ status: "paused", ended_at: new Date() })).rejects.toThrow(
      /voice_call_status_check/,
    );
    await expect(call({ end_reason: "boredom" })).rejects.toThrow(/voice_call_end_reason_check/);
    await expect(call({ peer: "5".repeat(33) })).rejects.toThrow(/voice_call_peer_check/);
    await expect(call({ language: "x".repeat(36) })).rejects.toThrow(/voice_call_language_check/);
    await expect(call({ duration_seconds: -1 })).rejects.toThrow(/voice_call_duration_check/);
    // An open call has no end time, and a finished one has.
    await expect(call({ ended_at: new Date() })).rejects.toThrow(/voice_call_ended_check/);
    await expect(call({ status: "ended" })).rejects.toThrow(/voice_call_ended_check/);
    await call({
      status: "ended",
      ended_at: new Date(),
      end_reason: "hangup",
      duration_seconds: 12,
    });
    await call({ status: "failed", ended_at: new Date(), end_reason: "restart" });

    // The bot's voice has a limit.
    await expect(
      run(url, `update bot set voice = $1 where id = $2`, ["v".repeat(101), botId]),
    ).rejects.toThrow(/bot_voice_check/);
    await expect(
      run(url, `update bot set voice_language = $1 where id = $2`, ["l".repeat(36), botId]),
    ).rejects.toThrow(/bot_voice_language_check/);
    await run(url, `update bot set voice = 'nova', voice_language = 'pt-BR' where id = $1`, [
      botId,
    ]);

    // A call keeps its bot in place; deleting the chat deletes its calls.
    await expect(run(url, `delete from bot where id = $1`, [botId])).rejects.toThrow();
    await run(url, `delete from conversation where id = $1`, [chatId]);
    expect(await run(url, `select count(*)::int as n from voice_call`)).toEqual([{ n: 0 }]);
    await run(url, `delete from bot where id = $1`, [botId]);
    await run(url, `delete from "user" where id in ('u-one', 'u-two')`);
  },
  240_000,
);

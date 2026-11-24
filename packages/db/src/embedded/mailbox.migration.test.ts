// The `mailbox` migration, run on a database that already holds people, a bot, a chat and a sealed connection: they stay as they are, and
// the new table keeps its rules (one address per person and kind, one provisioned address overall, limits, and what each reference does
// when the thing it points to goes).
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "mailbox";
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
  "mailbox adds one table and leaves the rows that exist alone",
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
    expect((await tables()).has("mailbox")).toBe(false);

    // Rows that exist: two people, a bot with a chat, and a sealed connection.
    for (const id of ["u-one", "u-two"])
      await run(
        url,
        `insert into "user" (id, name, email) values ($1, $1, $1 || '@example.invalid')`,
        [id],
      );
    const [{ id: botId }] = await run(
      url,
      `insert into bot (owner_user_id, kind, visibility, name, slug) values ('u-one', 'specialist', 'private', 'Mail bot', 'mail-bot-mig') returning id`,
    );
    const [{ id: chatId }] = await run(
      url,
      `insert into conversation (owner_user_id, bot_id) values ('u-one', $1) returning id`,
      [botId],
    );
    const connectionId = "0192f000-0000-7000-8000-000000000002";
    await run(
      url,
      `insert into connection (id, owner_user_id, kind, provider, label, state, revision, created_at, updated_at, current_credential_version)
       values ($1, 'u-one', 'api-key', 'mailbox', 'Mailbox password', 'active', 1, now(), now(), 1)`,
      [connectionId],
    );

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);
    expect((await tables()).has("mailbox")).toBe(true);

    // Nothing that existed changed.
    expect(await run(url, `select count(*)::int as n from "user"`)).toEqual([{ n: 2 }]);
    expect(await run(url, `select name from bot where id = $1`, [botId])).toEqual([
      { name: "Mail bot" },
    ]);
    expect(await run(url, `select label from connection where id = $1`, [connectionId])).toEqual([
      { label: "Mailbox password" },
    ]);

    const add = (
      owner: string,
      kind: string,
      address: string,
      extra: Record<string, unknown> = {},
    ) => {
      const cols = ["owner_user_id", "kind", "address", ...Object.keys(extra)];
      return run(
        url,
        `insert into mailbox (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        [owner, kind, address, ...Object.values(extra)],
      );
    };

    // Defaults: a version 7 id, active, sending on, empty config and senders, no bot, secret or chat.
    const [first] = await add("u-one", "imap", "Ana@Example.invalid");
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first).toMatchObject({
      label: "",
      state: "active",
      sending: "on",
      last_error: null,
      config: {},
      allowed_senders: [],
      bot_id: null,
      connection_id: null,
      chat_conversation_id: null,
    });
    expect(first.created_at).toBeInstanceOf(Date);
    expect(first.updated_at).toBeInstanceOf(Date);

    // One address per person and kind, whatever its case; another kind or another person may use it.
    await expect(add("u-one", "imap", "ana@example.invalid")).rejects.toThrow(
      /mailbox_owner_kind_address_unique/,
    );
    await add("u-one", "google", "ana@example.invalid");
    await add("u-two", "imap", "ana@example.invalid");

    // An address handed out by the installation belongs to one person only.
    await add("u-one", "provisioned", "bot1@example.invalid");
    await expect(add("u-two", "provisioned", "BOT1@example.invalid")).rejects.toThrow(
      /mailbox_provisioned_address_unique/,
    );

    // The closed lists and the limits.
    await expect(add("u-one", "pop3", "x@example.invalid")).rejects.toThrow(/mailbox_kind_check/);
    await expect(add("u-one", "imap", "y@example.invalid", { state: "gone" })).rejects.toThrow(
      /mailbox_state_check/,
    );
    await expect(add("u-one", "imap", "y@example.invalid", { sending: "maybe" })).rejects.toThrow(
      /mailbox_sending_check/,
    );
    await expect(add("u-one", "imap", "  ")).rejects.toThrow(/mailbox_address_check/);
    await expect(
      add("u-one", "imap", "y@example.invalid", { label: "x".repeat(121) }),
    ).rejects.toThrow(/mailbox_label_check/);
    await expect(
      add("u-one", "imap", "y@example.invalid", { last_error: "x".repeat(501) }),
    ).rejects.toThrow(/mailbox_last_error_check/);
    await expect(add("u-one", "imap", "y@example.invalid", { config: "[]" })).rejects.toThrow(
      /mailbox_config_check/,
    );
    await expect(
      add("u-one", "imap", "y@example.invalid", { allowed_senders: "{}" }),
    ).rejects.toThrow(/mailbox_allowed_senders_check/);
    await expect(add("u-ghost", "imap", "z@example.invalid")).rejects.toThrow(
      /mailbox_owner_user_id_user_id_fkey/,
    );

    // The bot, the secret and the chat are only references: they go, the mailbox stays and forgets them.
    const [linked] = await add("u-one", "imap", "linked@example.invalid", {
      bot_id: botId,
      connection_id: connectionId,
      chat_conversation_id: chatId,
    });
    await run(url, `delete from connection where id = $1`, [connectionId]);
    await run(url, `delete from conversation where id = $1`, [chatId]);
    await run(url, `delete from bot where id = $1`, [botId]);
    expect(
      await run(
        url,
        `select bot_id, connection_id, chat_conversation_id from mailbox where id = $1`,
        [linked.id],
      ),
    ).toEqual([{ bot_id: null, connection_id: null, chat_conversation_id: null }]);

    // A person who owns a mailbox cannot be deleted; once the mailboxes go, they can.
    await expect(run(url, `delete from "user" where id = 'u-one'`)).rejects.toThrow(
      /mailbox_owner_user_id_user_id_fkey/,
    );
    await run(url, `delete from mailbox`);
    await run(url, `delete from "user" where id in ('u-one', 'u-two')`);
  },
  240_000,
);

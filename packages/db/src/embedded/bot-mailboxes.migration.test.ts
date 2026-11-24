// The `bot_mailboxes` migration, run on a database that already holds people, bots, channel routes, installation settings and a mailbox:
// every one of them stays as it was, the installation settings gain the mail columns with their defaults, a route may now belong to a
// mailbox, and the old "one route per person and plugin" rule still holds for every route that has none.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "bot_mailboxes";
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
  "bot_mailboxes keeps every existing row and loosens the route rule only for mailbox routes",
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
    const columns = (table: string) =>
      run(
        url,
        `select column_name from information_schema.columns where table_schema = 'zetta' and table_name = $1`,
        [table],
      ).then((rows) => new Set(rows.map((r) => r.column_name as string)));
    expect((await columns("installation_settings")).has("mail_provider")).toBe(false);
    expect((await columns("inbound_route")).has("mailbox_id")).toBe(false);

    // Rows that exist: two people, two bots, three channel routes (one per person and plugin), settings and a mailbox.
    for (const id of ["u-one", "u-two"])
      await run(
        url,
        `insert into "user" (id, name, email) values ($1, $1, $1 || '@example.invalid')`,
        [id],
      );
    const bots: string[] = [];
    for (const [owner, slug] of [
      ["u-one", "route-bot-a"],
      ["u-two", "route-bot-b"],
    ] as const) {
      const [{ id }] = await run(
        url,
        `insert into bot (owner_user_id, kind, visibility, name, slug) values ($1, 'specialist', 'private', $2, $2) returning id`,
        [owner, slug],
      );
      bots.push(id);
    }
    const routes: string[] = [];
    for (const [owner, bot, plugin] of [
      ["u-one", bots[0], "telegram"],
      ["u-one", bots[0], "mail"],
      ["u-two", bots[1], "telegram"],
    ] as const) {
      const [{ id }] = await run(
        url,
        `insert into inbound_route (owner_user_id, bot_id, plugin_id, poll_every_seconds) values ($1, $2, $3, 90) returning id`,
        [owner, bot, plugin],
      );
      routes.push(id);
    }
    await run(
      url,
      `insert into installation_settings (id, network_mode, speech_provider) values (1, 'local', 'openai')`,
    );
    const [{ id: oldMailbox }] = await run(
      url,
      `insert into mailbox (owner_user_id, kind, address) values ('u-one', 'imap', 'old@example.invalid') returning id`,
    );
    await run(
      url,
      `insert into inbound_route (owner_user_id, bot_id, plugin_id) values ('u-one', $1, 'slack')`,
      [bots[0]],
    );
    // The old rule: a second route of the same person and plugin is refused.
    await expect(
      run(
        url,
        `insert into inbound_route (owner_user_id, bot_id, plugin_id) values ('u-one', $1, 'telegram')`,
        [bots[0]],
      ),
    ).rejects.toThrow(/inbound_route_owner_plugin/);

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);

    // Nothing that existed was lost or changed.
    const kept = await run(
      url,
      `select owner_user_id, plugin_id, poll_every_seconds, mailbox_id from inbound_route order by plugin_id, owner_user_id`,
    );
    expect(kept).toEqual([
      { owner_user_id: "u-one", plugin_id: "mail", poll_every_seconds: 90, mailbox_id: null },
      { owner_user_id: "u-one", plugin_id: "slack", poll_every_seconds: 60, mailbox_id: null },
      { owner_user_id: "u-one", plugin_id: "telegram", poll_every_seconds: 90, mailbox_id: null },
      { owner_user_id: "u-two", plugin_id: "telegram", poll_every_seconds: 90, mailbox_id: null },
    ]);
    expect(await run(url, `select count(*)::int as n from bot`)).toEqual([{ n: 2 }]);
    expect(
      await run(url, `select address, removed_at from mailbox where id = $1`, [oldMailbox]),
    ).toEqual([{ address: "old@example.invalid", removed_at: null }]);

    // The settings keep what they had and gain the mail columns, off by default.
    expect(
      await run(
        url,
        `select speech_provider, mail_provider, mail_domain, mail_connection_id, mail_cursor from installation_settings where id = 1`,
      ),
    ).toEqual([
      {
        speech_provider: "openai",
        mail_provider: "off",
        mail_domain: "",
        mail_connection_id: null,
        mail_cursor: null,
      },
    ]);
    await expect(
      run(url, `update installation_settings set mail_provider = 'smtp' where id = 1`),
    ).rejects.toThrow(/installation_settings_mail_check/);
    await expect(
      run(url, `update installation_settings set mail_domain = $1 where id = 1`, ["x".repeat(254)]),
    ).rejects.toThrow(/installation_settings_mail_check/);

    // The rule still holds for routes with no mailbox...
    await expect(
      run(
        url,
        `insert into inbound_route (owner_user_id, bot_id, plugin_id) values ('u-one', $1, 'telegram')`,
        [bots[0]],
      ),
    ).rejects.toThrow(/inbound_route_owner_plugin_unique/);

    // ...and each provisioned mailbox may have a route of its own, one only.
    const boxes: string[] = [];
    for (const address of ["a-1111@bots.example.invalid", "b-2222@bots.example.invalid"]) {
      const [{ id }] = await run(
        url,
        `insert into mailbox (owner_user_id, kind, address, bot_id) values ('u-one', 'provisioned', $1, $2) returning id`,
        [address, bots[0]],
      );
      boxes.push(id);
      await run(
        url,
        `insert into inbound_route (owner_user_id, bot_id, plugin_id, mailbox_id) values ('u-one', $1, 'botmail', $2)`,
        [bots[0], id],
      );
    }
    await expect(
      run(
        url,
        `insert into inbound_route (owner_user_id, bot_id, plugin_id, mailbox_id) values ('u-one', $1, 'botmail', $2)`,
        [bots[0], boxes[0]],
      ),
    ).rejects.toThrow(/inbound_route_mailbox_unique/);

    // Stored mail: defaults, one row per provider reference, the closed lists, the size cap.
    const put = (box: string, ref: string, extra: Record<string, unknown> = {}) => {
      const cols = [
        "mailbox_id",
        "provider_ref",
        "direction",
        "thread_key",
        ...Object.keys(extra).map((k) => `"${k}"`),
      ];
      return run(
        url,
        `insert into mailbox_message (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        [box, ref, "in", "t-1", ...Object.values(extra)],
      );
    };
    const [msg] = await put(boxes[0]!, "ref-1");
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(msg).toMatchObject({
      references: [],
      to_addresses: [],
      authentication: {},
      attachments: "none",
      raw_mime: null,
      size: 0,
    });
    await expect(put(boxes[0]!, "ref-1")).rejects.toThrow(/mailbox_message_provider_ref_unique/);
    await put(boxes[1]!, "ref-1");
    await expect(
      run(
        url,
        `insert into mailbox_message (mailbox_id, provider_ref, direction, thread_key) values ($1, 'r2', 'sideways', 't')`,
        [boxes[0]],
      ),
    ).rejects.toThrow(/mailbox_message_direction_check/);
    await expect(put(boxes[0]!, "ref-3", { references: "{}" })).rejects.toThrow(
      /mailbox_message_refs_check/,
    );
    await expect(
      run(
        url,
        `insert into mailbox_message (mailbox_id, provider_ref, direction, thread_key, raw_mime) values ($1, 'big', 'in', 't', repeat('a', 15728641)::bytea)`,
        [boxes[0]],
      ),
    ).rejects.toThrow(/mailbox_message_raw_check/);

    // A mailbox with mail or a route cannot be deleted from under them.
    await expect(run(url, `delete from mailbox where id = $1`, [boxes[0]])).rejects.toThrow(
      /mailbox_message_mailbox_id_mailbox_id_fkey|inbound_route_mailbox_id_mailbox_id_fkey/,
    );
    await run(url, `delete from mailbox_message`);
    await run(url, `delete from inbound_route where mailbox_id is not null`);
    await run(url, `delete from mailbox where kind = 'provisioned'`);
  },
  240_000,
);

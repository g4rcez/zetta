// The `microsoft_mailbox` migration, run on a database that already holds a mailbox of every kind: each one stays as it was, the kind
// list now accepts `microsoft`, an unknown kind is still refused, and the one-address-per-person-and-kind rule covers the new kind too.
import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { migrationNames } from "./migrate";
import { checkoutArchive, checkoutMigrations } from "./paths";
import { startEmbeddedDatabase } from "./resolve";

const MIGRATION = "microsoft_mailbox";
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
  "microsoft_mailbox lets the kind list take microsoft and keeps every existing mailbox",
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
    const add = (kind: string, address: string, extra: Record<string, unknown> = {}) => {
      const cols = ["owner_user_id", "kind", "address", ...Object.keys(extra)];
      return run(
        url,
        `insert into mailbox (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        ["u-one", kind, address, ...Object.values(extra)],
      );
    };

    await run(
      url,
      `insert into "user" (id, name, email) values ('u-one', 'u-one', 'u-one@example.invalid')`,
    );
    // Before: a mailbox of each kind there was, with settings that must survive.
    const config = { imapHost: "imap.example.invalid", imapPort: 993, user: "ana" };
    await add("imap", "ana@example.invalid", { label: "Work", config: JSON.stringify(config) });
    await add("google", "ana-g@example.invalid", { sending: "off" });
    await add("provisioned", "bot1@example.invalid", { state: "retired" });
    await expect(add("microsoft", "ana-m@example.invalid")).rejects.toThrow(/mailbox_kind_check/);
    const snapshot = () =>
      run(
        url,
        `select id, kind, address, label, state, sending, config from mailbox order by address`,
      );
    const kept = await snapshot();
    expect(kept.map((r) => r.kind).sort()).toEqual(["google", "imap", "provisioned"]);

    const after = await startEmbeddedDatabase(
      home,
      { archive: checkoutArchive(), migrations: through },
      "process",
    );
    stops.push(after.stop);
    expect(after.url).toBe(url);

    // Nothing that existed changed.
    expect(await snapshot()).toEqual(kept);

    // The new kind is accepted, with the defaults of any other.
    const [micro] = await add("microsoft", "Ana-M@Example.invalid");
    expect(micro).toMatchObject({
      kind: "microsoft",
      state: "active",
      sending: "on",
      config: {},
      connection_id: null,
    });
    // One address per person and kind, whatever its case; the other kinds still accept the same address.
    await expect(add("microsoft", "ana-m@example.invalid")).rejects.toThrow(
      /mailbox_owner_kind_address_unique/,
    );
    await add("imap", "ana-m@example.invalid");
    // Anything else is still refused.
    await expect(add("pop3", "x@example.invalid")).rejects.toThrow(/mailbox_kind_check/);
    await expect(add("Microsoft", "y@example.invalid")).rejects.toThrow(/mailbox_kind_check/);

    // The constraint holds exactly the four kinds.
    const [{ def }] = await run(
      url,
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'mailbox_kind_check'`,
    );
    for (const kind of ["imap", "google", "microsoft", "provisioned"])
      expect(def).toContain(`'${kind}'`);

    await run(url, `delete from mailbox`);
    await run(url, `delete from "user" where id = 'u-one'`);
  },
  240_000,
);

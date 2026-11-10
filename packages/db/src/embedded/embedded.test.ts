import { afterAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { materializeMigrations, migrationNames, pendingMigrations, pruneBackups } from "./migrate";
import {
  archiveName,
  checkoutArchive,
  checkoutMigrations,
  embeddedLayout,
  zettaHome,
} from "./paths";
import { startEmbeddedDatabase } from "./resolve";
import { runtimeBinaries } from "./runtime";
import {
  chooseTransport,
  connectionUrl,
  parsePostmasterPid,
  settingsFile,
  stopEmbedded,
} from "./supervisor";

const scratch = mkdtempSync(join(tmpdir(), "zetta-embedded-unit-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("embedded paths", () => {
  test("ZETTA_HOME wins over the default folder", () => {
    expect(zettaHome({ ZETTA_HOME: " /data/zetta " })).toBe("/data/zetta");
    expect(zettaHome({})).toEndWith(".zetta");
  });

  test("the archive is named after the versions and the platform", () => {
    expect(archiveName("linux-x64")).toMatch(
      /^pg-runtime-\d+\.\d+-\d+\.\d+\.\d+-linux-x64\.tar\.zst$/,
    );
  });
});

describe("embedded transport", () => {
  test("a short folder uses a socket, a long one or Windows uses loopback", () => {
    expect(chooseTransport("/srv/zetta/postgres/run", "linux")).toBe("socket");
    expect(chooseTransport(`/${"x".repeat(100)}/run`, "darwin")).toBe("tcp");
    expect(chooseTransport("C:/zetta/postgres/run", "win32")).toBe("tcp");
  });

  test("the pid file names the endpoint of a running server", () => {
    const socket =
      "4242\n/data\n1762750000\n5432\n/srv/zetta/postgres/run\n\n  5432001  65536\nready\n";
    expect(parsePostmasterPid(socket)).toEqual({
      transport: "socket",
      directory: "/srv/zetta/postgres/run",
    });
    const tcp = "4242\n/data\n1762750000\n51234\n\n127.0.0.1\n  5432001  65536\nready\n";
    expect(parsePostmasterPid(tcp)).toEqual({ transport: "tcp", port: 51234 });
    expect(parsePostmasterPid("4242\n/data\n")).toBeUndefined();
  });

  test("connection strings carry the password only over loopback", () => {
    expect(connectionUrl({ transport: "socket", directory: "/a b/run" }, "secret")).toBe(
      "postgresql://postgres@localhost/zetta?host=%2Fa%20b%2Frun",
    );
    expect(connectionUrl({ transport: "tcp", port: 51234 }, "secret", "postgres")).toBe(
      "postgresql://postgres:secret@127.0.0.1:51234/postgres",
    );
  });

  test("a socket server never listens on the network", () => {
    const socket = settingsFile({ transport: "socket", directory: "/it's/run" });
    expect(socket).toContain("listen_addresses = ''");
    expect(socket).toContain("unix_socket_directories = '/it''s/run'");
    expect(settingsFile({ transport: "tcp", port: 51234 })).toContain(
      "listen_addresses = '127.0.0.1'",
    );
  });
});

describe("embedded migrations", () => {
  test("pending migrations are the folder minus what the database recorded", () => {
    expect(pendingMigrations(["1_a", "2_b", "3_c"], ["1_a", "2_b"])).toEqual(["3_c"]);
    expect(pendingMigrations(["1_a"], ["1_a"])).toEqual([]);
  });

  test("only folders with a migration.sql count, oldest first", () => {
    const folder = join(scratch, "names");
    for (const name of ["20260102000000_b", "20260101000000_a", "empty"])
      mkdirSync(join(folder, name), { recursive: true });
    writeFileSync(join(folder, "20260102000000_b", "migration.sql"), "select 2;");
    writeFileSync(join(folder, "20260101000000_a", "migration.sql"), "select 1;");
    expect(migrationNames(folder)).toEqual(["20260101000000_a", "20260102000000_b"]);
  });

  test("a bundled migration file is written out as folders once", async () => {
    const layout = embeddedLayout(join(scratch, "bundle-home"));
    const bundle = join(scratch, "migrations.json");
    writeFileSync(bundle, JSON.stringify([{ name: "20260101000000_a", sql: "select 1;" }]));
    const folder = await materializeMigrations(bundle, layout);
    expect(migrationNames(folder)).toEqual(["20260101000000_a"]);
    expect(await materializeMigrations(bundle, layout)).toBe(folder);
    expect(await materializeMigrations("/some/folder", layout)).toBe("/some/folder");
  });

  test("old backups are removed, the newest are kept", () => {
    const folder = join(scratch, "backups");
    for (const day of ["01", "02", "03", "04"])
      mkdirSync(join(folder, `postgres-202611${day}T000000-before-x`), { recursive: true });
    mkdirSync(join(folder, "something-else"));
    expect(pruneBackups(folder, 3)).toEqual(["postgres-20261101T000000-before-x"]);
    expect(readdirSync(folder).sort()).toEqual([
      "postgres-20261102T000000-before-x",
      "postgres-20261103T000000-before-x",
      "postgres-20261104T000000-before-x",
      "something-else",
    ]);
  });
});

// Needs the runtime archive for this computer: `bun run db:runtime`.
const real = existsSync(checkoutArchive()) ? describe : describe.skip;

real("embedded Postgres, started for real", () => {
  // Under /tmp on purpose: the socket path must stay short.
  const home = mkdtempSync(process.platform === "win32" ? join(tmpdir(), "zpg-") : "/tmp/zpg-");
  const stops: (() => void)[] = [];
  afterAll(() => {
    for (const stop of stops.reverse()) stop();
    rmSync(home, { recursive: true, force: true });
  });

  const query = async (url: string, text: string) => {
    const client = new Client({ connectionString: url, options: "-c search_path=zetta" });
    await client.connect();
    try {
      return (await client.query(text)).rows;
    } finally {
      await client.end();
    }
  };

  test("first start migrates, a later start adopts it, and new migrations back the data up first", async () => {
    const all = migrationNames(checkoutMigrations());
    const older = join(home, "older-migrations");
    for (const name of all.slice(0, -1))
      cpSync(join(checkoutMigrations(), name), join(older, name), { recursive: true });

    const first = await startEmbeddedDatabase(home, {
      archive: checkoutArchive(),
      migrations: older,
    });
    stops.push(first.stop);
    expect(first.mode).toBe("embedded");
    expect(
      await query(first.url, "select count(*)::int as n from drizzle.__drizzle_migrations"),
    ).toEqual([{ n: all.length - 1 }]);
    expect(existsSync(embeddedLayout(home).backups)).toBe(false);

    const second = await startEmbeddedDatabase(home, {
      archive: checkoutArchive(),
      migrations: checkoutMigrations(),
    });
    stops.push(second.stop);
    expect(
      await query(second.url, "select count(*)::int as n from drizzle.__drizzle_migrations"),
    ).toEqual([{ n: all.length }]);
    const backups = readdirSync(embeddedLayout(home).backups);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toEndWith(`-before-${all.at(-1)}`);
    expect(existsSync(join(embeddedLayout(home).backups, backups[0]!, "PG_VERSION"))).toBe(true);

    const [row] = await query(
      second.url,
      `select uuidv7() is not null as uuid, f_unaccent('ação') as plain, '[1,2,3]'::vector <=> '[1,2,4]'::vector > 0 as distance,
                (select count(*)::int from pg_tables where schemaname = 'zetta') as tables, current_setting('TimeZone') as zone`,
    );
    expect(row).toMatchObject({ uuid: true, plain: "acao", distance: true, zone: "UTC" });
    expect(row.tables).toBeGreaterThan(50);

    const third = await startEmbeddedDatabase(home, {
      archive: checkoutArchive(),
      migrations: checkoutMigrations(),
    });
    expect(third.url).toBe(second.url);
    expect(readdirSync(embeddedLayout(home).backups)).toHaveLength(1);

    // A process that adopted the server (after a crash, say) still stops it on the way out.
    third.stop();
    await expect(query(second.url, "select 1")).rejects.toThrow();

    // Started detached, it outlives the processes that use it.
    const sources = { archive: checkoutArchive(), migrations: checkoutMigrations() };
    const detached = await startEmbeddedDatabase(home, sources, "detached");
    (await startEmbeddedDatabase(home, sources)).stop();
    expect(await query(detached.url, "select 1 as up")).toEqual([{ up: 1 }]);
    const layout = embeddedLayout(home);
    expect(stopEmbedded(runtimeBinaries(layout.runtime), layout)).toBe("stopped");
    expect(stopEmbedded(runtimeBinaries(layout.runtime), layout)).toBe("idle");
  }, 180_000);
});

import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { readdirSync, readFileSync } from "node:fs";
import { runs, runAttempts } from "./runs";

const dialect = new PgDialect();
function checks(table: PgTable) {
  return Object.fromEntries(
    getTableConfig(table).checks.map(({ name, value }) => {
      const query = dialect.sqlToQuery(value);
      expect(query.params).toEqual([]);
      return [name, query.sql.replace(/\s+/g, " ").trim()];
    }),
  );
}
const folder = new URL("../../run-test-migrations/", import.meta.url).pathname;
async function migrations() {
  return (
    await Array.fromAsync(new Bun.Glob("*/migration.sql").scan({ cwd: folder, absolute: true }))
  ).sort();
}

describe("durable run offline schema contract (not PostgreSQL execution)", () => {
  test("imports without environment, network, timers or application startup", async () => {
    const script = `
      import net from 'node:net'; import tls from 'node:tls';
      const deny = () => { throw new Error('unexpected startup'); };
      Bun.serve = deny; Bun.connect = deny; net.Socket.prototype.connect = deny;
      tls.connect = deny; globalThis.fetch = deny; globalThis.setTimeout = deny; globalThis.setInterval = deny;
      const schema = await import(${JSON.stringify(import.meta.resolve("./runs"))});
      if (Object.keys(schema).sort().join(',') !== 'runAttempts,runs') throw new Error('unexpected exports');
      console.log('offline import PASS');
    `;
    const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
      env: {},
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(
      await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]),
    ).toEqual([0, "offline import PASS\n", ""]);
  });

  test("preserves private canonical Unicode text as an exact bound parameter", () => {
    const inputSnapshot = JSON.stringify([1, "quote'\\slash", "é", "e\u0301", null, []]);
    const query = drizzle
      .mock()
      .insert(runs)
      .values({
        id: "00000000-0000-4000-8000-000000000001",
        ownerUserId: "owner",
        requestKey: "00000000-0000-4000-8000-000000000002",
        originKind: "interactive",
        botId: "bot",
        conversationId: "conversation",
        configurationId: "configuration",
        configurationVersion: 1,
        inputVersion: 1,
        inputSnapshot,
        createdAt: new Date(0),
        revision: 1,
        status: "queued",
        currentGeneration: 1,
      })
      .toSQL();
    expect(query.params).toContain(inputSnapshot);
    expect(query.sql).not.toContain(inputSnapshot);
    expect(runs.inputSnapshot.getSQLType()).toBe("text");
    expect(
      [runs, runAttempts]
        .flatMap((table) => getTableConfig(table).columns)
        .some((column) => /json/.test(column.getSQLType())),
    ).toBe(false);
  });

  test("binds owners to membership and attempts to their owner's run without cascades", () => {
    const graph = [runs, runAttempts].flatMap((table) =>
      getTableConfig(table).foreignKeys.map((key) => {
        const ref = key.reference();
        return [
          getTableName(table),
          ref.columns.map((column) => column.name),
          getTableName(ref.foreignTable),
          ref.foreignColumns.map((column) => column.name),
          key.onDelete,
          key.onUpdate,
        ];
      }),
    );
    expect(graph).toEqual([
      ["runs", ["owner_user_id"], "membership", ["user_id"], "restrict", "restrict"],
      [
        "run_attempts",
        ["run_id", "owner_user_id"],
        "runs",
        ["id", "owner_user_id"],
        "restrict",
        "restrict",
      ],
    ]);
    expect(
      [runs, runAttempts].map((table) =>
        getTableConfig(table).uniqueConstraints.map((key) =>
          key.columns.map((column) => column.name),
        ),
      ),
    ).toEqual([
      [
        ["owner_user_id", "request_key"],
        ["id", "owner_user_id"],
      ],
      [
        ["run_id", "generation"],
        ["id", "run_id", "owner_user_id"],
      ],
    ]);
  });

  test("compiles closed states and byte/int bounds without runtime placeholders", () => {
    const run = checks(runs),
      attempt = checks(runAttempts);
    expect(run["runs_input_check"]).toBe(
      '"zetta"."runs"."input_version" = 1 and octet_length("zetta"."runs"."input_snapshot") between 1 and 98304 and "zetta"."runs"."input_snapshot" is json array',
    );
    expect(attempt["run_attempts_generation_check"]).toBe(
      '"zetta"."run_attempts"."generation" between 1 and 2147483647',
    );
    expect(run["runs_counters_check"]?.match(/between 1 and 2147483647/g)).toHaveLength(3);
    expect(attempt["run_attempts_result_check"]).toContain(
      'octet_length("zetta"."run_attempts"."result_text") <= 65536',
    );
    expect(attempt["run_attempts_result_check"]).toContain(
      '"zetta"."run_attempts"."result_last_sequence" between 0 and 1000',
    );
    expect(run["runs_origin_check"]).toContain("in ('interactive','setup')");
    expect(attempt["run_attempts_effect_check"]).toContain("in ('no_effect','known','uncertain')");
    expect(attempt["run_attempts_cancellation_check"]).toContain("'owner_requested'");
    expect(runAttempts.resultErrorCode.enumValues).toEqual([
      "invalid_input",
      "unsupported",
      "malformed_output",
      "out_of_order",
      "output_limit",
      "tool_denied",
      "tool_failed",
      "outcome_uncertain",
      "deadline",
      "adapter_failed",
    ]);
    for (const column of [
      runs.configurationVersion,
      runs.revision,
      runs.currentGeneration,
      runAttempts.generation,
      runAttempts.resultLastSequence,
    ])
      expect(column.getSQLType()).toBe("integer");
    for (const column of [runs.createdAt, runAttempts.claimedAt, runAttempts.stopConfirmedAt])
      expect(column.getSQLType()).toBe("timestamp (3) with time zone");
  });

  test("separates actual stop facts from logical running/terminal states", () => {
    const attempt = checks(runAttempts);
    const running = attempt["run_attempts_lifecycle_check"]?.split("or (")[1];
    expect(running).toContain("'running'");
    expect(running).toContain('"lease_id" is not null');
    expect(running).toContain('"finished_at" is null');
    expect(running).not.toContain('"stop_confirmed_at"');
    expect(attempt["run_attempts_lease_check"]).toContain('"claimed_at" is not null');
    expect(attempt["run_attempts_time_check"]).toContain(
      '"stop_confirmed_at" >= "zetta"."run_attempts"."claimed_at"',
    );
  });

  test("retains a feature-only generated table migration and separate ordered custom migration", async () => {
    const files = await migrations();
    expect(files).toHaveLength(2);
    const initial = files[0],
      custom = files[1];
    if (!initial || !custom) throw new Error("missing migrations");
    expect(initial).toContain("_runs_initial/");
    expect(custom).toContain("_runs_constraints/");
    const ddl = await Bun.file(initial).text(),
      trigger = await Bun.file(custom).text();
    expect(
      [...ddl.matchAll(/CREATE TABLE "zetta"\."([^"]+)"/g)].map((match) => match[1]).sort(),
    ).toEqual(["run_attempts", "runs"]);
    expect(ddl).toContain(
      'REFERENCES "zetta"."membership"("user_id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(ddl).not.toMatch(
      /CREATE FUNCTION|CREATE TRIGGER|DROP |ALTER TABLE "(?:membership|user|session)"/,
    );
    expect(trigger).not.toMatch(/CREATE TABLE|SECURITY DEFINER|EXECUTE\s+'|WHEN\s*\(/i);
    const first = await Bun.file(initial.replace("migration.sql", "snapshot.json")).json();
    const second = await Bun.file(custom.replace("migration.sql", "snapshot.json")).json();
    expect(second.prevIds).toEqual([first.id]);
    expect(second.ddl).toEqual(first.ddl);
  });

  test("reviews deferred trigger coverage, current-row locks and immutable identities", async () => {
    const custom = (await migrations())[1];
    if (!custom) throw new Error("missing custom migration");
    const ddl = await Bun.file(custom).text();
    expect(ddl).toContain("AFTER INSERT OR UPDATE ON zetta.runs\nDEFERRABLE INITIALLY DEFERRED");
    expect(ddl).toContain(
      "AFTER INSERT OR UPDATE OR DELETE ON zetta.run_attempts\nDEFERRABLE INITIALLY DEFERRED",
    );
    expect(ddl).toContain(
      "SELECT current_generation INTO required_generation FROM zetta.runs WHERE id = target_run FOR UPDATE",
    );
    expect(ddl).toContain(
      "WHERE run_id = target_run AND generation = required_generation FOR KEY SHARE",
    );
    expect(ddl).toContain("PERFORM 1 FROM zetta.runs WHERE id = OLD.run_id FOR UPDATE");
    expect(ddl).toContain("BEFORE UPDATE OR DELETE ON zetta.run_attempts");
    for (const field of [
      "id",
      "owner_user_id",
      "request_key",
      "origin_kind",
      "bot_id",
      "conversation_id",
      "configuration_id",
      "configuration_version",
      "input_version",
      "input_snapshot",
      "created_at",
      "run_id",
      "generation",
    ]) {
      expect(ddl).toContain(`NEW.${field}`);
      expect(ddl).toContain(`OLD.${field}`);
    }
    expect(ddl).toContain(
      "OLD.lease_id IS NOT NULL AND NEW.lease_id IS DISTINCT FROM OLD.lease_id",
    );
    expect(ddl).toContain("NEW.lease_expires_at < OLD.lease_expires_at");
    expect(ddl.match(/ERRCODE = '23514'/g)).toHaveLength(5);
  });

  test("keeps producer metadata nullable without defaults or a mutable-revision foreign key", () => {
    const columns = getTableConfig(runs).columns.filter((column) =>
      ["producer_kind", "producer_version", "actor_activation_revision"].includes(column.name),
    );
    expect(
      columns.map((column) => [
        column.name,
        column.getSQLType(),
        column.notNull,
        column.hasDefault,
        column.default,
      ]),
    ).toEqual([
      ["producer_kind", "text", false, false, undefined],
      ["producer_version", "integer", false, false, undefined],
      ["actor_activation_revision", "integer", false, false, undefined],
    ]);
    expect(
      getTableConfig(runs).foreignKeys.flatMap((key) =>
        key.reference().columns.map((column) => column.name),
      ),
    ).toEqual(["owner_user_id"]);
    expect(runs.producerKind.enumValues).toEqual(["fixture"]);
  });

  test("explicitly excludes every partial tuple from SQL CHECK's UNKNOWN acceptance", () => {
    expect(checks(runs)["runs_producer_check"]).toBe(
      '("zetta"."runs"."producer_kind" is null and "zetta"."runs"."producer_version" is null and "zetta"."runs"."actor_activation_revision" is null) ' +
        'or ("zetta"."runs"."producer_kind" is not null and "zetta"."runs"."producer_version" is not null and "zetta"."runs"."actor_activation_revision" is not null ' +
        'and "zetta"."runs"."producer_kind" = \'fixture\' and "zetta"."runs"."producer_version" = 1 and "zetta"."runs"."actor_activation_revision" between 1 and 2147483647)',
    );
  });

  test("loads only provenance feature SQL, retaining byte-identical snapshot-only ancestors", () => {
    const feature = new URL("../../run-provenance-test-migrations/", import.meta.url).pathname;
    const ancestors = readdirSync(folder).sort();
    for (const ancestor of ancestors) {
      expect(readdirSync(`${feature}/${ancestor}`)).toEqual(["snapshot.json"]);
      expect(readFileSync(`${feature}/${ancestor}/snapshot.json`)).toEqual(
        readFileSync(`${folder}/${ancestor}/snapshot.json`),
      );
    }
    const loaded = readMigrationFiles({ migrationsFolder: feature });
    expect(loaded.map((migration) => migration.name.replace(/^\d{14}_/, ""))).toEqual([
      "run_provenance",
      "run_provenance_guard",
    ]);
    expect(readdirSync(feature)).toHaveLength(ancestors.length + 2);
    const delta = loaded[0],
      guard = loaded[1];
    if (!delta || !guard) throw new Error("missing provenance migrations");
    expect(delta.sql).toHaveLength(4);
    expect(delta.sql.map((statement) => statement.trim().split("\n")[0])).toEqual([
      'ALTER TABLE "zetta"."runs" ADD COLUMN "producer_kind" text;',
      'ALTER TABLE "zetta"."runs" ADD COLUMN "producer_version" integer;',
      'ALTER TABLE "zetta"."runs" ADD COLUMN "actor_activation_revision" integer;',
      expect.stringContaining(
        'ALTER TABLE "zetta"."runs" ADD CONSTRAINT "runs_producer_check" CHECK',
      ),
    ]);
    expect(delta.sql.join("\n")).not.toMatch(/DEFAULT|UPDATE|CREATE|DROP|REFERENCES/i);
    expect(delta.sql.slice(0, 3).join("\n")).not.toMatch(/NOT NULL/i);
    const generatedCheck = delta.sql[3]?.trim().replace(/\s+/g, " ");
    expect(generatedCheck).toBe(
      `ALTER TABLE "zetta"."runs" ADD CONSTRAINT "runs_producer_check" CHECK (${checks(runs)["runs_producer_check"]?.replaceAll('"zetta"."runs".', "")});`,
    );
    const trigger = guard.sql.join("\n");
    expect(trigger).toContain("BEFORE UPDATE ON zetta.runs");
    expect(trigger).toContain("FOR EACH ROW EXECUTE FUNCTION zetta.runs_guard_producer()");
    for (const field of ["producer_kind", "producer_version", "actor_activation_revision"]) {
      expect(trigger).toContain(`NEW.${field} IS DISTINCT FROM OLD.${field}`);
    }
    expect(trigger).toContain("ERRCODE = '23514', CONSTRAINT = 'runs_producer_immutable'");
    expect(trigger).not.toMatch(
      /CREATE TABLE|SECURITY DEFINER|SELECT|UPDATE\s+zetta\.|DELETE|WHEN\s*\(|EXECUTE\s+'/i,
    );
  });
});

import { expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { dispatchCapacity, dispatchClaims, dispatchGrants } from "./dispatch";

const tables = [dispatchCapacity, dispatchClaims, dispatchGrants];
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
const folder = new URL("../../dispatch-test-migrations/", import.meta.url).pathname;
async function migrations() {
  return (
    await Array.fromAsync(new Bun.Glob("*/migration.sql").scan({ cwd: folder, absolute: true }))
  ).sort();
}

test("dispatch schema is an inert import with exactly three exports", async () => {
  const script = `import net from 'node:net'; import tls from 'node:tls';
    const deny=()=>{throw new Error('unexpected startup')};
    Bun.serve=deny; Bun.connect=deny; net.Socket.prototype.connect=deny; tls.connect=deny;
    globalThis.fetch=deny; globalThis.setTimeout=deny; globalThis.setInterval=deny;
    const s=await import(${JSON.stringify(import.meta.resolve("./dispatch"))});
    if(Object.keys(s).sort().join(',')!=='dispatchCapacity,dispatchClaims,dispatchGrants') throw new Error('exports');
    console.log('offline import PASS');`;
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

test("FK graph uses existing attempt triple and new capacity/claim keys, never credentials", () => {
  expect(
    tables.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((key) => {
        const ref = key.reference();
        return [
          getTableName(table),
          ref.columns.map((c) => c.name),
          getTableName(ref.foreignTable),
          ref.foreignColumns.map((c) => c.name),
          key.onDelete,
          key.onUpdate,
        ];
      }),
    ),
  ).toEqual([
    [
      "dispatch_claims",
      ["attempt_id", "run_id", "owner_user_id"],
      "run_attempts",
      ["id", "run_id", "owner_user_id"],
      "restrict",
      "restrict",
    ],
    [
      "dispatch_claims",
      ["launcher_installation_id", "policy_version"],
      "dispatch_capacity",
      ["launcher_installation_id", "policy_version"],
      "restrict",
      "restrict",
    ],
    [
      "dispatch_grants",
      ["attempt_id", "run_id", "owner_user_id"],
      "dispatch_claims",
      ["attempt_id", "run_id", "owner_user_id"],
      "restrict",
      "restrict",
    ],
  ]);
  expect(
    tables.map((t) => getTableConfig(t).uniqueConstraints.map((k) => k.columns.map((c) => c.name))),
  ).toEqual([
    [["launcher_installation_id", "policy_version"]],
    [
      ["claim_operation_id"],
      ["attempt_id", "run_id", "owner_user_id"],
      ["launcher_installation_id", "receipt_id"],
    ],
    [
      ["attempt_id", "action_id"],
      ["attempt_id", "kind", "sequence"],
    ],
  ]);
});

test("exact canonical text is a parameter, with no JSON normalization or defaults", () => {
  const canonicalAction = JSON.stringify([1, "quote'\\slash", "é", "e\u0301", null]);
  const id = "00000000-0000-4000-8000-000000000001";
  const q = drizzle
    .mock()
    .insert(dispatchGrants)
    .values({
      id,
      attemptId: id,
      runId: id,
      ownerUserId: "owner",
      actionId: id,
      kind: "activate",
      sequence: 1,
      canonicalAction,
      actionDigest: "a".repeat(64),
      expiresAt: new Date(1000),
      state: "pending",
      deliveryOutcome: "not_attempted",
      revision: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })
    .toSQL();
  expect(q.params).toContain(canonicalAction);
  expect(q.sql).not.toContain(canonicalAction);
  for (const t of tables)
    for (const c of getTableConfig(t).columns) {
      expect(c.hasDefault).toBe(false);
      expect(c.getSQLType()).not.toMatch(/json/);
    }
  expect(dispatchGrants.canonicalAction.getSQLType()).toBe("text");
});

test("capacity and occupancy indexes retain all unreleased states", () => {
  const c = checks(dispatchCapacity);
  expect(c["dispatch_capacity_limits_check"]).toContain('"global_limit" = 2');
  expect(c["dispatch_capacity_limits_check"]).toContain('"actor_limit" = 1');
  const all = getTableConfig(dispatchClaims).indexes;
  // The only non-occupancy index serves the dispatch_capacity foreign key.
  expect(all.filter((i) => !i.config.where).map((i) => i.config.name)).toEqual([
    "dispatch_claims_launcher_installation_id_policy_version_idx",
  ]);
  const indexes = all.filter((i) => i.config.where);
  expect(indexes).toHaveLength(2);
  for (const i of indexes) {
    expect(i.config.where).toBeDefined();
    if (!i.config.where) throw new Error("missing occupancy predicate");
    expect(dialect.sqlToQuery(i.config.where).sql).toBe(
      '"zetta"."dispatch_claims"."released_at" is null',
    );
  }
  expect(getTableConfig(dispatchClaims).columns.map((c) => c.name)).not.toContain(
    "lease_expires_at",
  );
  expect(getTableConfig(dispatchClaims).columns.map((c) => c.name)).not.toContain("logical_status");
});

test("closed row checks retain fixture-only credentials, bounds and nullable fact pairs", () => {
  const c = checks(dispatchClaims),
    g = checks(dispatchGrants);
  expect(g["dispatch_grants_credentials_check"]).toBe(
    '"zetta"."dispatch_grants"."connection_id" is null and "zetta"."dispatch_grants"."credential_version" is null',
  );
  expect(g["dispatch_grants_action_check"]).toContain("between 1 and 65537");
  expect(g["dispatch_grants_payload_check"]).toContain("between 1 and 16384");
  expect(c["dispatch_claims_payload_check"]).toContain("is json array");
  expect(c["dispatch_claims_pending_check"]).toContain("is null");
  expect(c["dispatch_claims_cleanup_check"]).toContain("'removed'");
  expect(c["dispatch_claims_release_check"]).toContain('"pending_operation_id" is null');
  expect(g["dispatch_grants_state_check"]).toContain("'uncertain'");
  expect(g["dispatch_grants_state_check"]).toContain("('unknown','acknowledged')");
  for (const t of tables) {
    const compiled = Object.values(checks(t)).join(" ");
    for (const column of getTableConfig(t).columns.filter((c) =>
      c.getSQLType().startsWith("timestamp"),
    )) {
      expect(compiled).toContain(`isfinite("zetta"."${getTableName(t)}"."${column.name}")`);
    }
    expect(compiled).not.toMatch(/clock_timestamp|now\(/);
  }
});

test("generator creates only three dispatch tables and an unchanged custom snapshot lineage", async () => {
  const files = await migrations();
  expect(files).toHaveLength(2);
  const initial = files[0],
    custom = files[1];
  if (!initial || !custom) throw new Error("missing migrations");
  expect(initial).toContain("_dispatch_initial/");
  expect(custom).toContain("_dispatch_guards/");
  const ddl = await Bun.file(initial).text();
  expect([...ddl.matchAll(/CREATE TABLE "zetta"\."([^"]+)"/g)].map((m) => m[1]).sort()).toEqual([
    "dispatch_capacity",
    "dispatch_claims",
    "dispatch_grants",
  ]);
  expect(ddl).toContain('REFERENCES "zetta"."run_attempts"("id","run_id","owner_user_id")');
  expect(ddl).not.toMatch(/DROP |ALTER TABLE "(?:runs|run_attempts|membership|user|connection)"/);
  const first = await Bun.file(initial.replace("migration.sql", "snapshot.json")).json();
  const second = await Bun.file(custom.replace("migration.sql", "snapshot.json")).json();
  expect(second.prevIds).toEqual([first.id]);
  expect(second.ddl).toEqual(first.ddl);
});

test("custom guards explicitly retain tombstones and reject initial spent claims/grants", async () => {
  const file = (await migrations())[1];
  if (!file) throw new Error("missing guards");
  const ddl = await Bun.file(file).text();
  for (const table of ["dispatch_capacity", "dispatch_claims", "dispatch_grants"])
    expect(ddl).toContain(`BEFORE TRUNCATE ON zetta.${table}`);
  for (const name of [
    "dispatch_capacity_frozen",
    "dispatch_claims_initial",
    "dispatch_grants_initial",
    "dispatch_claims_identity_immutable",
    "dispatch_grants_identity_immutable",
    "dispatch_claims_forward_only",
    "dispatch_grants_forward_only",
    "dispatch_revision_monotonic",
    "dispatch_tombstones_retained",
  ])
    expect(ddl).toContain(`CONSTRAINT = '${name}'`);
  expect(ddl).toContain("NEW.resource_state <> 'not_submitted'");
  expect(ddl).toContain("NEW.state <> 'pending'");
  expect(ddl).toContain("OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL");
  expect(ddl).toContain("OLD.delivery_outcome = 'acknowledged'");
  expect(ddl).toContain(
    "OLD.state = 'pending' AND NEW.state = 'pending' AND NEW IS DISTINCT FROM OLD",
  );
  expect(ddl).toContain("OLD.revision = 2147483647");
  expect(ddl).not.toMatch(
    /FOR UPDATE|FOR KEY SHARE|SECURITY DEFINER|CREATE TABLE|EXECUTE\s+'|SELECT\s+.*FROM/i,
  );
});

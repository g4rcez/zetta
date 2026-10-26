import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { PoolClient } from "pg";
import { z } from "zod";
import { canonicalRunInput } from "../../../apps/server/src/modules/runtime/run-contract";

const folder = fileURLToPath(new URL("../run-provenance-test-migrations/", import.meta.url));
const legacyFolder = fileURLToPath(new URL("../run-test-migrations/", import.meta.url));
const manifest = [
  { name: "20261022180455_runs_initial", files: [{ name: "snapshot.json", hash: "888c5ec8ffe5b4389b14a4281cdefcbbd6220493e66647e7f557c471865e7bc5" }] },
  { name: "20261022180711_runs_constraints", files: [{ name: "snapshot.json", hash: "6c0a17f4c839a2b973f1455917f8a3bea821744356544b18b7fe5970a7e217e1" }] },
  { name: "20261022202048_run_provenance", files: [
    { name: "migration.sql", hash: "0679d8a29e9f888dd51c9ebb6c971e3ae6e03dc83fbb63349b1c2df6dc49beb5" },
    { name: "snapshot.json", hash: "10e735fef9149031bf233131ee87ad944043d9a653cdf9fa423a8378d2b0b28b" }] },
  { name: "20261022202056_run_provenance_guard", files: [
    { name: "migration.sql", hash: "c1426a7537d5b39a28f9e505977ea6bf6f80553182907d46de704adb46586d29" },
    { name: "snapshot.json", hash: "0d8794e0925b2dcbafb50a48bf706911b3bcd822a03415bed9347b15d9f9eced" }] },
];
const legacy = [
  { name: "20261022180455_runs_initial", hash: "fe2e46816c2e2fc046cec7eb7e017f30911f1de2fbc3a745eb2417c0e83a372a" },
  { name: "20261022180711_runs_constraints", hash: "35f95e21e74a777dbe3527ae4d0ae9aa545e2c639ee8a3292ea08d84f8b0d785" },
];
function check(value: unknown): asserts value { if (!value) throw new Error("Run provenance proof unavailable."); }
export function assertRunProvenanceManifest(raw: unknown): void {
  try { check(JSON.stringify(raw) === JSON.stringify(manifest)); } catch { throw new Error("Run provenance proof unavailable."); }
}
export async function verifyRunProvenanceSources(): Promise<void> {
  try {
    const actual = [];
    check(JSON.stringify((await readdir(folder)).sort()) === JSON.stringify(manifest.map(m => m.name)));
    for (const entry of manifest) {
      const name = entry.name;
      check(JSON.stringify((await readdir(`${folder}/${name}`)).sort()) === JSON.stringify(entry.files.map(f => f.name)));
      const files = [];
      for (const file of (await readdir(`${folder}/${name}`)).sort()) {
        files.push({ name: file, hash: createHash("sha256").update(await readFile(`${folder}/${name}/${file}`)).digest("hex") });
      }
      actual.push({ name, files });
    }
    assertRunProvenanceManifest(actual);
    check(JSON.stringify((await readdir(legacyFolder)).sort()) === JSON.stringify(legacy.map(m => m.name)));
    for (const migration of legacy) {
      const path = `${legacyFolder}/${migration.name}`;
      check(JSON.stringify((await readdir(path)).sort()) === JSON.stringify(["migration.sql", "snapshot.json"]));
      check(createHash("sha256").update(await readFile(`${path}/migration.sql`)).digest("hex") === migration.hash);
      check((await readFile(`${path}/snapshot.json`)).equals(await readFile(`${folder}/${migration.name}/snapshot.json`)));
    }
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    check(JSON.stringify(migrations.map(m => ({ name: m.name, hash: m.hash })))
      === JSON.stringify(manifest.slice(2).map(m => ({ name: m.name, hash: m.files[0]?.hash }))));
  } catch { throw new Error("Run provenance proof unavailable."); }
}
const constraintExpression = "(((producer_kindISNULL)AND(producer_versionISNULL)AND(actor_activation_revisionISNULL))"
  + "OR((producer_kindISNOTNULL)AND(producer_versionISNOTNULL)AND(actor_activation_revisionISNOTNULL)"
  + "AND(producer_kind='fixture'::text)AND(producer_version=1)AND((actor_activation_revision>=1)AND(actor_activation_revision<=2147483647))))";
const catalog = z.strictObject({ columns_ok: z.literal(true), check_ok: z.literal(true), check_expression: z.literal(constraintExpression),
  function_ok: z.literal(true), trigger_ok: z.literal(true) });
export function assertRunProvenanceCatalog(raw: unknown): void { check(catalog.safeParse(raw).success); }
const expressionToken = /(?:producer_kind|producer_version|actor_activation_revision|ISNOTNULL|ISNULL|AND|OR|'fixture'|::text|[()]|>=|<=|=|[0-9]{1,10})/g;
export function projectRunProvenanceCatalog(raw: unknown) {
  const shape = z.object({ columns_ok: z.unknown(), check_ok: z.unknown(), check_expression: z.unknown(), function_ok: z.unknown(), trigger_ok: z.unknown() }).safeParse(raw);
  const row = shape.success ? shape.data : undefined;
  const expression = row?.check_expression;
  return Object.freeze({ columns_ok: typeof row?.columns_ok === "boolean" ? row.columns_ok : null,
    check_ok: typeof row?.check_ok === "boolean" ? row.check_ok : null,
    check_expression: typeof expression === "string" && expression.length > 0 && expression.length <= 2048
      && expression.match(expressionToken)?.join("") === expression ? expression : null,
    function_ok: typeof row?.function_ok === "boolean" ? row.function_ok : null,
    trigger_ok: typeof row?.trigger_ok === "boolean" ? row.trigger_ok : null });
}
export class RunProvenanceSetupError extends Error {
  constructor(readonly stage: "sources" | "apply" | "catalog-query" | "catalog-verification" | "journal-verification",
    readonly catalog: ReturnType<typeof projectRunProvenanceCatalog> | null) {
    super("Run provenance proof unavailable.");
  }
}
export async function inspectRunProvenanceCatalog(client: PoolClient) {
    const sql = await readFile(`${folder}/20261022202056_run_provenance_guard/migration.sql`, "utf8");
    const body = sql.split("AS $$")[1]?.split("$$;")[0]; check(body);
    const [row] = (await client.query(`select
      (select count(*)=3 and bool_and(not a.attnotnull and not a.attisdropped and d.oid is null
        and a.attidentity='' and a.attgenerated='' and a.atttypid=case a.attname
          when 'producer_kind' then 'text'::regtype else 'integer'::regtype end)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid='public.runs'::regclass and a.attname in ('producer_kind','producer_version','actor_activation_revision')) as columns_ok,
      (select count(*)=1 and bool_and(c.contype='c' and c.convalidated and c.conenforced and not c.connoinherit
        and not c.condeferrable and not c.condeferred and c.conislocal and c.coninhcount=0 and c.conparentid=0)
        from pg_constraint c where c.conrelid='public.runs'::regclass and c.conname='runs_producer_check') as check_ok,
      (select regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]"]','','g')
        from pg_constraint c where c.conrelid='public.runs'::regclass and c.conname='runs_producer_check') as check_expression,
      (select count(*)=1 and bool_and(p.prosrc=$1 and not p.prosecdef and p.proconfig is null and p.pronargs=0
        and p.prorettype='trigger'::regtype and p.prokind='f' and p.provolatile='v' and l.lanname='plpgsql')
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
        where n.nspname='public' and p.proname='runs_guard_producer') as function_ok,
      (select count(*)=1 and bool_and(t.tgtype=19 and t.tgenabled='O' and not t.tgisinternal and t.tgqual is null
        and t.tgnargs=0 and octet_length(t.tgargs)=0 and t.tgattr::text='' and t.tgconstraint=0
        and t.tgfoid='public.runs_guard_producer()'::regprocedure)
        from pg_trigger t where t.tgrelid='public.runs'::regclass and t.tgname='runs_producer_immutable') as trigger_ok`, [body])).rows;
    return projectRunProvenanceCatalog(row);
}
export async function verifyRunProvenance(client: PoolClient): Promise<void> {
  let stage: RunProvenanceSetupError["stage"] = "sources";
  let facts: ReturnType<typeof projectRunProvenanceCatalog> | null = null;
  try {
    await verifyRunProvenanceSources();
    stage = "catalog-query";
    facts = await inspectRunProvenanceCatalog(client);
    stage = "catalog-verification";
    assertRunProvenanceCatalog(facts);
    stage = "journal-verification";
    const expected = [...legacy, ...manifest.slice(2).map(m => ({ name: m.name, hash: m.files[0]?.hash }))];
    const journal = await client.query<{ name: string; hash: string }>(`select name,hash from drizzle.__drizzle_migrations
      where name=any($1::text[]) order by name`, [expected.map(m => m.name)]);
    check(JSON.stringify(journal.rows) === JSON.stringify(expected));
  } catch { throw new RunProvenanceSetupError(stage, facts); }
}
export async function applyRunProvenance(client: PoolClient): Promise<void> {
  let stage: RunProvenanceSetupError["stage"] = "sources";
  try {
    await verifyRunProvenanceSources();
    stage = "apply";
    await migrate(drizzle({ client, logger: false }), { migrationsFolder: folder });
    await verifyRunProvenance(client);
  } catch (error) {
    if (error instanceof RunProvenanceSetupError) throw error;
    throw new RunProvenanceSetupError(stage, null);
  }
}
const legacyInput = canonicalRunInput({ requestKey: "009d5000-0000-4000-8000-000000000002", origin: "interactive",
  botId: "legacy-bot", conversationId: "legacy-conversation", configurationId: "legacy-configuration", configurationVersion: 1,
  input: { prompt: "synthetic legacy run", harness: "fixture", model: null, connections: [], resumeReference: null,
    budgets: { deadlineMs: 1000, maxEvents: 3, maxOutputBytes: 1000, maxToolBytes: 100, maxToolCalls: 0 } } });
async function verifyLegacyRows(client: PoolClient, layered: boolean): Promise<void> {
  const [row] = (await client.query<{ run_ok: boolean; attempt_ok: boolean }>(`select
    (select count(*)=1 and bool_and(id='009d5000-0000-4000-8000-000000000001' and owner_user_id='run-legacy-owner'
      and request_key='009d5000-0000-4000-8000-000000000002' and origin_kind='interactive' and bot_id='legacy-bot'
      and conversation_id='legacy-conversation' and configuration_id='legacy-configuration' and configuration_version=1
      and input_version=1 and input_snapshot=$1 and created_at=timestamptz '2000-01-01T00:00:00Z'
      and revision=1 and status='queued' and current_generation=1 and cancel_requested_at is null and started_at is null and finished_at is null
      ${layered ? "and producer_kind is null and producer_version is null and actor_activation_revision is null" : ""}) from public.runs) as run_ok,
    (select count(*)=1 and bool_and(id='009d5000-0000-4000-8000-000000000003' and run_id='009d5000-0000-4000-8000-000000000001'
      and owner_user_id='run-legacy-owner' and generation=1 and created_at=timestamptz '2000-01-01T00:00:00Z'
      and status='queued' and effect_state='no_effect' and lease_id is null and lease_expires_at is null and claimed_at is null
      and started_at is null and finished_at is null and stop_confirmed_at is null and result_version is null and result_text is null
      and result_error_code is null and result_last_sequence is null and cancellation_reason is null) from public.run_attempts) as attempt_ok`, [legacyInput])).rows;
  check(row?.run_ok === true && row.attempt_ok === true);
}
export async function seedRunLegacyProvenance(client: PoolClient): Promise<void> {
  try {
    await client.query("begin");
    const [row] = (await client.query<{ absent: boolean }>(`select
      not exists(select 1 from pg_attribute where attrelid='public.runs'::regclass
        and attname in ('producer_kind','producer_version','actor_activation_revision') and not attisdropped)
      and not exists(select 1 from pg_trigger where tgrelid='public.runs'::regclass and tgname='runs_producer_immutable')
      and not exists(select 1 from pg_constraint where conrelid='public.runs'::regclass and conname='runs_producer_check')
      and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='runs_guard_producer')
      and not exists(select 1 from public.runs) and not exists(select 1 from public.run_attempts)
      and not exists(select 1 from public."user") and not exists(select 1 from public.membership) as absent`)).rows;
    check(row?.absent === true);
    await client.query(`insert into public."user"(id,name,email,email_verified,created_at,updated_at) values
      ('run-legacy-owner','synthetic','run-legacy@invalid.test',false,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z');
      insert into public.membership(user_id,activation_revision,status,joined_at,removed_at,updated_at) values
      ('run-legacy-owner',1,'active','2000-01-01T00:00:00Z',null,'2000-01-01T00:00:00Z')`);
    await client.query(`insert into public.runs(id,owner_user_id,request_key,origin_kind,bot_id,conversation_id,configuration_id,
      configuration_version,input_version,input_snapshot,created_at,revision,status,current_generation) values
      ('009d5000-0000-4000-8000-000000000001','run-legacy-owner','009d5000-0000-4000-8000-000000000002','interactive',
      'legacy-bot','legacy-conversation','legacy-configuration',1,1,$1,'2000-01-01T00:00:00Z',1,'queued',1)`, [legacyInput]);
    await client.query(`insert into public.run_attempts(id,run_id,owner_user_id,generation,created_at,status,effect_state) values
      ('009d5000-0000-4000-8000-000000000003','009d5000-0000-4000-8000-000000000001','run-legacy-owner',1,'2000-01-01T00:00:00Z','queued','no_effect')`);
    await verifyLegacyRows(client, false);
    await client.query("commit");
  } catch {
    try { await client.query("rollback"); } finally { throw new Error("Run provenance proof unavailable."); }
  }
}
export async function verifyRunLegacyProvenance(client: PoolClient): Promise<void> {
  try { await verifyLegacyRows(client, true); } catch { throw new Error("Run provenance proof unavailable."); }
}

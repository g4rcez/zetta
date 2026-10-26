// Test-only fixed activation layer; no configurable target, SQL, paths or fixture callbacks.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as migrateSelected } from "drizzle-orm/pg-core/async/session";
import type { PoolClient } from "pg";
import { z } from "zod";
const folder = fileURLToPath(new URL("../identity-activation-test-migrations/", import.meta.url));
const manifest = [
  { name: "20261022123627_identity_initial", files: [{ name: "snapshot.json", hash: "44a4c293d665da0c98548e0cd1012809edc79b83c32ae2f8c96dda248ab70cd7" }] },
  { name: "20261022202532_identity_activation_revision", files: [
    { name: "migration.sql", hash: "fd479f854f62a49e47acbb8be281115c90903a412e3e79aa3ec263bdab36b723" },
    { name: "snapshot.json", hash: "4a62abccadf5ec5a257c8cfe85588fa5d2e7d2c0d39bed141ed7c034e6d21e99" }] },
  { name: "20261022202537_identity_activation_guards", files: [
    { name: "migration.sql", hash: "1bc761f3b0434ea4a0a67b20ec1198af7981b8a459383520ad67fd248fc1d714" },
    { name: "snapshot.json", hash: "c1122213f9d82935a4ae1127a43ccd8fed3a140ab53f2ddedaa07dc7d307739f" }] },
];
function check(value: unknown): asserts value { if (!value) throw new Error("Identity activation proof unavailable."); }
/** Pure comparison only; never authorizes migration application on supplied data. */
export function assertActivationManifest(raw: unknown) {
  try { check(JSON.stringify(raw) === JSON.stringify(manifest)); } catch { throw new Error("Identity activation proof unavailable."); }
}
export async function verifyActivationSources(): Promise<void> {
  try {
    const actual = [];
    for (const name of (await readdir(folder)).sort()) {
      const files = [];
      for (const file of (await readdir(`${folder}/${name}`)).sort()) files.push({ name: file, hash: createHash("sha256").update(await readFile(`${folder}/${name}/${file}`)).digest("hex") });
      actual.push({ name, files });
    }
    assertActivationManifest(actual);
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    check(JSON.stringify(migrations.map(m => ({ name: m.name, hash: m.hash }))) === JSON.stringify(manifest.slice(1).map(m => ({ name: m.name, hash: m.files[0]?.hash }))));
  } catch { throw new Error("Identity activation proof unavailable."); }
}
const catalog = z.strictObject({ column_ok: z.literal(true), check_ok: z.literal(true), function_ok: z.literal(true), trigger_ok: z.literal(true) });
export function assertActivationCatalog(raw: unknown) { check(catalog.safeParse(raw).success); }
/** Read-only validation for both fresh setup and a separately verified reconnect. */
export async function verifyIdentityActivation(client: PoolClient): Promise<void> {
  try {
    await verifyActivationSources();
    const sql = await readFile(`${folder}/20261022202537_identity_activation_guards/migration.sql`, "utf8");
    const body = sql.split("AS $$")[1]?.split("$$;")[0]; check(body);
    const [row] = (await client.query(`select
      (select count(*)=1 and bool_and(a.atttypid='integer'::regtype and a.attnotnull and not a.attisdropped
        and a.attidentity='' and a.attgenerated='' and pg_get_expr(d.adbin,d.adrelid)='1')
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid='public.membership'::regclass and a.attname='activation_revision') as column_ok,
      (select count(*)=1 and bool_and(c.contype='c' and c.convalidated and not c.connoinherit
        and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[()[:space:]"]','','g')='activation_revision>=1ANDactivation_revision<=2147483647')
        from pg_constraint c where c.conrelid='public.membership'::regclass and c.conname='membership_activation_revision_check') as check_ok,
      (select count(*)=1 and bool_and(p.prosrc=$1 and not p.prosecdef and p.proconfig is null and p.pronargs=0
        and p.prorettype='trigger'::regtype and p.prokind='f' and p.provolatile='v' and l.lanname='plpgsql')
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
        where n.nspname='public' and p.proname='membership_guard_activation_revision') as function_ok,
      (select count(*)=1 and bool_and(t.tgtype=23 and t.tgenabled='O' and not t.tgisinternal and t.tgqual is null
        and t.tgnargs=0 and octet_length(t.tgargs)=0 and t.tgattr::text='' and t.tgconstraint=0
        and t.tgfoid='public.membership_guard_activation_revision()'::regprocedure)
        from pg_trigger t where t.tgrelid='public.membership'::regclass and t.tgname='membership_activation_revision_guard') as trigger_ok`, [body])).rows;
    assertActivationCatalog(row);
    const journal = await client.query<{ name: string; hash: string }>(`select name,hash from drizzle.__drizzle_migrations
      where name=any($1::text[]) order by name`, [manifest.map(m => m.name)]);
    check(JSON.stringify(journal.rows) === JSON.stringify([
      { name: "20261022123627_identity_initial", hash: "2277a1d657eb88cd98de5ee99a46af70243c22350ae4a53bdb19d606bf46a2d4" },
      ...manifest.slice(1).map(m => ({ name: m.name, hash: m.files[0]?.hash })),
    ]));
  } catch { throw new Error("Identity activation proof unavailable."); }
}
/** Fixed synthetic pre-layer rows; caller cannot choose identities, SQL or values. */
export async function seedIdentityActivationBackfill(client: PoolClient): Promise<void> {
  try {
  const [row] = (await client.query<{ absent: boolean }>(`select not exists(select 1 from pg_attribute
    where attrelid='public.membership'::regclass and attname='activation_revision' and not attisdropped) as absent`)).rows;
  check(row?.absent);
  await client.query(`insert into public."user"(id,name,email,email_verified,created_at,updated_at) values
    ('activation-legacy-active','synthetic','activation-active@invalid.test',false,'2000-01-01T00:00:00Z','2000-01-02T00:00:00Z'),
    ('activation-legacy-removed','synthetic','activation-removed@invalid.test',false,'2000-01-01T00:00:00Z','2000-01-02T00:00:00Z');
    insert into public.membership(user_id,status,joined_at,removed_at,updated_at) values
    ('activation-legacy-active','active','2000-01-01T00:00:00Z',null,'2000-01-02T00:00:00Z'),
    ('activation-legacy-removed','removed','2000-01-01T00:00:00Z','2000-01-02T00:00:00Z','2000-01-02T00:00:00Z')`);
  await verifyLegacyRows(client, false);
  } catch { throw new Error("Identity activation proof unavailable."); }
}
async function verifyLegacyRows(client: PoolClient, layered: boolean) {
  const [row] = (await client.query<{ exact: boolean }>(`select count(*)=2 and bool_and(
    joined_at=timestamptz '2000-01-01T00:00:00Z' and updated_at=timestamptz '2000-01-02T00:00:00Z'
    and ((user_id='activation-legacy-active' and status='active' and removed_at is null)
      or (user_id='activation-legacy-removed' and status='removed' and removed_at=timestamptz '2000-01-02T00:00:00Z'))
    ${layered ? "and activation_revision=1" : ""}) as exact from public.membership`)).rows;
  check(row?.exact);
}
export async function applyIdentityActivation(client: PoolClient): Promise<void> {
  try {
  await verifyActivationSources();
  await migrate(drizzle({ client, logger: false }), { migrationsFolder: folder });
  await verifyIdentityActivation(client);
  const tables = await client.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename");
  check(JSON.stringify(tables.rows.map(r => r.tablename)) === JSON.stringify(["account", "identity_audit", "installation_identity", "invitation", "membership", "session", "user", "verification"]));
  } catch { throw new Error("Identity activation proof unavailable."); }
}
export async function verifyIdentityActivationBackfill(client: PoolClient): Promise<void> {
  try { await verifyLegacyRows(client, true); } catch { throw new Error("Identity activation proof unavailable."); }
}
/** Fixed pre-guard MAX fixture, only reached by fresh exhaustion setup. No live guard is disabled. */
export async function seedIdentityActivationExhaustion(client: PoolClient): Promise<void> {
  try {
    await verifyActivationSources();
    const migrations = readMigrationFiles({ migrationsFolder: folder }), delta = migrations[0];
    check(migrations.length === 2 && delta?.name === "20261022202532_identity_activation_revision"
      && delta.hash === "fd479f854f62a49e47acbb8be281115c90903a412e3e79aa3ec263bdab36b723");
    await migrateSelected([delta], drizzle({ client, logger: false }), { migrationsFolder: folder });
    const journal = await client.query<{ name: string; hash: string }>("select name,hash from drizzle.__drizzle_migrations order by name");
    check(JSON.stringify(journal.rows) === JSON.stringify([
      { name: "20261022123627_identity_initial", hash: "2277a1d657eb88cd98de5ee99a46af70243c22350ae4a53bdb19d606bf46a2d4" },
      { name: delta.name, hash: delta.hash },
    ]));
    const [precondition] = (await client.query<{ ready: boolean }>(`select
      not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='membership_guard_activation_revision')
      and not exists(select 1 from pg_trigger where tgrelid='public.membership'::regclass and not tgisinternal)
      and (select count(*)=1 and bool_and(a.atttypid='integer'::regtype and a.attnotnull and not a.attisdropped
        and a.attidentity='' and a.attgenerated='' and pg_get_expr(d.adbin,d.adrelid)='1')
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid='public.membership'::regclass and a.attname='activation_revision')
      and (select count(*)=1 and bool_and(c.contype='c' and c.convalidated and not c.connoinherit
        and regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[()[:space:]"]','','g')='activation_revision>=1ANDactivation_revision<=2147483647')
        from pg_constraint c where c.conrelid='public.membership'::regclass and c.conname='membership_activation_revision_check')
      and not exists(select 1 from public.membership) and not exists(select 1 from public."user") as ready`)).rows;
    check(precondition?.ready);
    await client.query(`insert into public."user"(id,name,email,email_verified,created_at,updated_at) values
      ('activation-exhausted','synthetic','activation-exhausted@invalid.test',false,'2000-01-01T00:00:00Z','2000-01-02T00:00:00Z');
      insert into public.membership(user_id,activation_revision,status,joined_at,removed_at,updated_at) values
      ('activation-exhausted',2147483647,'removed','2000-01-01T00:00:00Z','2000-01-02T00:00:00Z','2000-01-02T00:00:00Z')`);
    await verifyIdentityActivationExhaustion(client);
  } catch { throw new Error("Identity activation proof unavailable."); }
}
export async function verifyIdentityActivationExhaustion(client: PoolClient): Promise<void> {
  try {
    const [row] = (await client.query<{ exact: boolean }>(`select
      (select count(*)=1 and bool_and(user_id='activation-exhausted' and activation_revision=2147483647 and status='removed'
        and joined_at=timestamptz '2000-01-01T00:00:00Z' and removed_at=timestamptz '2000-01-02T00:00:00Z'
        and updated_at=timestamptz '2000-01-02T00:00:00Z') from public.membership)
      and (select count(*)=1 and bool_and(id='activation-exhausted' and name='synthetic' and email='activation-exhausted@invalid.test'
        and email_verified=false and created_at=timestamptz '2000-01-01T00:00:00Z' and updated_at=timestamptz '2000-01-02T00:00:00Z')
        from public."user") as exact`)).rows;
    check(row?.exact);
  } catch { throw new Error("Identity activation proof unavailable."); }
}

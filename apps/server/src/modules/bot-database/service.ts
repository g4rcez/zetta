import { createHash, createHmac, hkdfSync, pbkdf2Sync, randomBytes } from "node:crypto";
import type { Database } from "@zetta/db";
import { Pool, type PoolClient, type QueryResult } from "@zetta/db/pg";
import { eq } from "@zetta/db/query";
import { botDatabase } from "@zetta/db/schema/bot-database";
import { bot } from "@zetta/db/schema/chat";
import { PluginError } from "../integrations/plugins/registry";
import { dbError } from "./errors";
import { ident, quoteName, schemaFor } from "./naming";
import { templateById } from "./templates";

/**
 * Every bot's private Postgres schema (`<slug>_bot`). Isolation is Postgres' job, not ours: each bot has its own LOGIN role that owns
 * nothing outside its schema, has no memberships (so SET ROLE goes nowhere) and, after the bot-database migration, no PUBLIC rights on
 * the app's schema, functions or database. Bot SQL only ever runs on a connection logged in as that role.
 *
 * Passwords are never stored: each is derived from the server key (HKDF, per role) and sent to Postgres as a SCRAM verifier, so not even
 * statement logs see it. If a bot changes its own password, or the key rotates, the next call re-provisions the role and retries once.
 * The bot can lift its own statement_timeout, so every call is also bounded from outside: past the deadline the app's connection
 * cancels the backend and the client is discarded.
 */
export type BotDatabaseConfig = {
  databaseUrl: string;
  key: string;
  quotaMb?: number;
  timeoutMs?: number;
  maxPools?: number;
};
export type Column = { name: string; type: string; description: string | null; nullable: boolean };
export type TableInfo = {
  name: string;
  description: string | null;
  columns: Column[];
  rows: number;
  bytes: number;
};
export type Overview = {
  schema: string;
  slug: string;
  access: boolean;
  templates: string[];
  usedBytes: number;
  quotaBytes: number;
  tables: TableInfo[];
};

const MAX_ROWS = 200;
const MAX_TABLES = 100;

/** Postgres SCRAM-SHA-256 verifier (what `PASSWORD '...'` stores), computed here so the clear password never travels in SQL. */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const stored = createHash("sha256")
    .update(createHmac("sha256", salted).update("Client Key").digest())
    .digest();
  const server = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${stored.toString("base64")}:${server.toString("base64")}`;
}

const notConfigured = () =>
  new PluginError(
    "NOT_CONFIGURED",
    "Bot databases are not set up on this server.",
    "Ask the administrator to set ZETTA_CONNECTION_KEY (or ZETTA_BOT_DATABASE_KEY) and to give the app's database user the CREATEROLE permission.",
  );
const adminError = (e: unknown) => {
  if (e instanceof PluginError) return e;
  const code = (e as { code?: unknown })?.code;
  if (code === "42501") return notConfigured();
  console.error(
    `bot database provisioning failed code=${typeof code === "string" ? code : "unknown"}`,
  ); // never the message: it may hold SQL
  return new PluginError(
    "FAILED",
    "Zetta could not prepare the bot's database.",
    "Try again. If it keeps failing, ask the administrator to check the server logs.",
  );
};
/** Values a person or bot can read: dates as ISO text, binary as a size, long text clipped. */
const plain = (v: unknown): unknown =>
  v instanceof Date
    ? v.toISOString()
    : Buffer.isBuffer(v)
      ? `<binary ${v.length} bytes>`
      : typeof v === "string" && v.length > 2000
        ? `${v.slice(0, 2000)}…`
        : v;
const plainRow = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));
const csvCell = (v: unknown) => {
  const s =
    v === null || v === undefined
      ? ""
      : typeof v === "object" && !(v instanceof Date)
        ? JSON.stringify(v)
        : String(v instanceof Date ? v.toISOString() : v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function createBotDatabase(db: Database, cfg: BotDatabaseConfig) {
  const admin = db.$client as unknown as Pool;
  const quotaBytes = (cfg.quotaMb ?? 50) * 1024 * 1024;
  const timeoutMs = cfg.timeoutMs ?? 8000;
  const passwordFor = (role: string) =>
    Buffer.from(hkdfSync("sha256", cfg.key, "zetta.bot-db.v1", role, 32)).toString("base64url");

  let capable: Promise<{ ok: boolean; su: boolean }> | undefined;
  /** Creating roles needs CREATEROLE (or superuser). Checked once; a failed check is retried on the next call. */
  const capability = () =>
    (capable ??= admin
      .query(
        "select rolsuper or rolcreaterole as ok, rolsuper as su from pg_roles where rolname = current_user",
      )
      .then((r) => ({ ok: !!r.rows[0]?.ok, su: !!r.rows[0]?.su }))
      .catch(() => {
        capable = undefined;
        return { ok: false, su: false };
      }));

  /** Creates or repairs the role and schema. Runs inside the caller's transaction, under an advisory lock on the schema name. */
  async function provision(c: PoolClient, schema: string, su: boolean) {
    const q = ident(schema);
    const [role] = (
      await c.query(
        "select rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls as risky from pg_roles where rolname = $1",
        [schema],
      )
    ).rows;
    if (role?.risky)
      throw new PluginError(
        "CONFLICT",
        "A database user with this bot's name already exists and has extra powers, so Zetta will not use it.",
        "Ask the administrator to rename or remove that database user.",
      );
    const verifier = scramVerifier(passwordFor(schema)); // base64 and "$:" only: safe inside a literal
    if (!role)
      await c.query(
        `create role ${q} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 3 password '${verifier}'`,
      );
    else
      await c.query(
        `alter role ${q} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 3 password '${verifier}'`,
      );
    await c.query(`create schema if not exists ${q}`); // owned by the app role: the bot can fill it but never drop or re-grant it
    await c.query(`revoke all on schema ${q} from public`);
    await c.query(`grant usage, create on schema ${q} to ${q}`);
    const [{ d }] = (await c.query("select current_database() as d")).rows;
    await c.query(`grant connect on database ${quoteName(d)} to ${q}`);
    // Session defaults the bot may have changed for itself are put back on every provisioning.
    await c.query(`alter role ${q} reset all`);
    for (const s of [
      `search_path = ${q}`,
      "statement_timeout = '5s'",
      "lock_timeout = '2s'",
      "idle_in_transaction_session_timeout = '10s'",
      "work_mem = '8MB'",
    ])
      await c.query(`alter role ${q} set ${s}`);
    // A non-superuser app role needs the bot role's privileges to cancel its runaway queries and drop what it owns; never SET ROLE.
    if (
      !su &&
      !(await c.query("select pg_has_role(current_user, $1, 'USAGE') as m", [schema])).rows[0]?.m
    )
      await c.query(`grant ${q} to current_user with inherit true, set false`);
  }

  const ready = new Map<string, string>(); // botId -> schema, provisioned by this process
  async function slugOf(botId: string) {
    const [b] = await db.select({ slug: bot.slug }).from(bot).where(eq(bot.id, botId));
    if (!b) throw new PluginError("NOT_FOUND", "That bot no longer exists.");
    return b.slug;
  }
  async function locked<T>(
    schema: string,
    work: (c: PoolClient, su: boolean) => Promise<T>,
  ): Promise<T> {
    const cap = await capability();
    if (!cap.ok) throw notConfigured();
    const c = await admin.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [`bot-db:${schema}`]);
      const out = await work(c, cap.su);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw adminError(e);
    } finally {
      c.release();
    }
  }
  /** Idempotent: the bot's role, schema and bookkeeping row exist and are configured. Cheap after the first call per process. */
  async function ensure(botId: string): Promise<string> {
    const hit = ready.get(botId);
    if (hit) return hit;
    const schema = schemaFor(await slugOf(botId));
    await locked(schema, async (c, su) => {
      await provision(c, schema, su);
      await c.query(
        "insert into bot_database (bot_id, schema_name, role_name) values ($1, $2, $2) on conflict (bot_id) do nothing",
        [botId, schema],
      );
    });
    ready.set(botId, schema);
    return schema;
  }

  const pools = new Map<string, Pool>();
  function poolFor(role: string) {
    const hit = pools.get(role);
    if (hit) {
      pools.delete(role);
      pools.set(role, hit);
      return hit;
    } // most recently used last
    const url = new URL(cfg.databaseUrl);
    url.username = role;
    url.password = passwordFor(role);
    const p = new Pool({
      connectionString: url.toString(),
      max: 2,
      idleTimeoutMillis: 30_000,
      application_name: "zetta-bot",
    });
    p.on("error", () => {
      /* idle client dropped by the server: the pool replaces it */
    });
    pools.set(role, p);
    if (pools.size > (cfg.maxPools ?? 50)) {
      const [old] = pools.keys();
      close(old!);
    }
    return p;
  }
  function close(role: string) {
    const p = pools.get(role);
    pools.delete(role);
    void p?.end().catch(() => {});
  }
  async function disconnect(c: PoolClient, role: string) {
    close(role);
    await c.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where usename = $1 and pid <> pg_backend_pid()",
      [role],
    );
  }

  /** Runs `work` on a connection logged in as the bot's own role, in one transaction with an outside deadline. */
  async function asBot<T>(
    botId: string,
    mode: "read" | "write",
    work: (c: PoolClient) => Promise<T>,
    retried = false,
  ): Promise<T> {
    const schema = await ensure(botId);
    let c: PoolClient;
    try {
      c = await poolFor(schema).connect();
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      // Wrong password or missing role: the bot changed its password, the key rotated, or the role was dropped. Re-provision once.
      if (!retried && (code === "28P01" || code === "28000")) {
        ready.delete(botId);
        close(schema);
        return asBot(botId, mode, work, true);
      }
      throw dbError(e);
    }
    const pid = (c as unknown as { processID?: number }).processID;
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      if (pid) void admin.query("select pg_cancel_backend($1)", [pid]).catch(() => {});
    }, timeoutMs);
    try {
      await c.query(mode === "read" ? "begin read only" : "begin");
      await c.query(`set local search_path = ${ident(schema)}`);
      await c.query(`set local statement_timeout = ${Math.max(1000, timeoutMs - 1000)}`);
      const out = await work(c);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw fired
        ? new PluginError(
            "TIMEOUT",
            "The database command took too long and was stopped.",
            "Ask the bot for something smaller, or to add an index.",
          )
        : dbError(e);
    } finally {
      clearTimeout(timer);
      c.release(fired);
    }
  }

  async function usedBytes(schema: string) {
    const r = await admin.query(
      "select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as b from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r', 'm')",
      [schema],
    );
    return Number(r.rows[0]?.b ?? 0);
  }
  async function assertRoom(schema: string) {
    if ((await usedBytes(schema)) >= quotaBytes)
      throw new PluginError(
        "QUOTA",
        `The bot's database is full (${Math.round(quotaBytes / 1048576)} MB).`,
        "Ask the bot to delete entries it no longer needs, or use Start over in the bot's settings > Database.",
      );
  }
  /** Tables as the bot sees them, read with the bot's own role (it can only ever list its own schema). */
  async function tables(c: PoolClient, schema: string): Promise<TableInfo[]> {
    const r = await c.query(
      `select c.relname as name, obj_description(c.oid, 'pg_class') as description, pg_total_relation_size(c.oid)::bigint as bytes,
        coalesce((select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'description', col_description(c.oid, a.attnum), 'nullable', not a.attnotnull) order by a.attnum)
          from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]') as columns
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm') order by c.relname limit ${MAX_TABLES}`,
      [schema],
    );
    const out: TableInfo[] = [];
    for (const t of r.rows) {
      const [{ n }] = (
        await c.query(`select count(*)::bigint as n from ${ident(schema)}.${quoteName(t.name)}`)
      ).rows;
      out.push({
        name: t.name,
        description: t.description,
        columns: t.columns,
        rows: Number(n),
        bytes: Number(t.bytes),
      });
    }
    return out;
  }
  async function findTable(c: PoolClient, schema: string, name: string) {
    const t = (await tables(c, schema)).find((x) => x.name === name);
    if (!t)
      throw new PluginError(
        "DB_NOT_FOUND",
        "That table does not exist.",
        "Refresh the page: the bot may have removed or renamed it.",
      );
    return t;
  }
  const orderOf = (t: TableInfo) =>
    t.columns.some((c) => c.name === "created_at")
      ? " order by created_at desc"
      : t.columns.some((c) => c.name === "id")
        ? " order by id desc"
        : "";
  const run = (c: PoolClient, text: string, params?: unknown[]) =>
    c.query({ text, values: params ?? [], queryMode: "extended" } as never) as Promise<QueryResult>;

  return {
    /** Whether this server can provision bot databases at all. */
    async available() {
      return (await capability()).ok;
    },
    ensure,
    /** Only the bot's owner may use its database: a bot shared with the team keeps one schema, which would mix every asker's entries. */
    async isOwner(botId: string, userId: string) {
      const [row] = await db.select({ owner: bot.ownerUserId }).from(bot).where(eq(bot.id, botId));
      return row?.owner === userId;
    },
    async access(botId: string) {
      const [row] = await db
        .select({ access: botDatabase.access })
        .from(botDatabase)
        .where(eq(botDatabase.botId, botId));
      return row?.access ?? true;
    },
    async setAccess(botId: string, enabled: boolean) {
      await ensure(botId);
      await db.update(botDatabase).set({ access: enabled }).where(eq(botDatabase.botId, botId));
      return { access: enabled };
    },
    async overview(botId: string): Promise<Overview> {
      const schema = await ensure(botId);
      const [row] = await db.select().from(botDatabase).where(eq(botDatabase.botId, botId));
      const list = await asBot(botId, "read", (c) => tables(c, schema));
      return {
        schema,
        slug: await slugOf(botId),
        access: row?.access ?? true,
        templates: row?.templates ?? [],
        usedBytes: await usedBytes(schema),
        quotaBytes,
        tables: list,
      };
    },
    /** Read-only SQL from the bot. One statement (extended protocol), at most MAX_ROWS rows back. */
    async query(botId: string, sql: string, params?: unknown[]) {
      const text = sql.trim().replace(/;\s*$/, "");
      return asBot(botId, "read", async (c) => {
        let r: QueryResult;
        try {
          await c.query("savepoint bounded");
          r = await run(c, `select * from (${text}) as zetta_q limit ${MAX_ROWS + 1}`, params);
        } catch (e) {
          if ((e as { code?: unknown })?.code !== "42601") throw e; // not a plain SELECT (SHOW, EXPLAIN...): run it as written
          await c.query("rollback to savepoint bounded");
          r = await run(c, text, params);
        }
        return {
          columns: r.fields.map((f) => f.name),
          rows: r.rows.slice(0, MAX_ROWS).map(plainRow),
          ...(r.rows.length > MAX_ROWS ? { truncated: true } : {}),
        };
      });
    },
    /** Changes from the bot: DDL and DML. Several statements are allowed only without params. Refused once the quota is reached. */
    async execute(botId: string, sql: string, params?: unknown[]) {
      const schema = await ensure(botId);
      await assertRoom(schema);
      return asBot(botId, "write", async (c) => {
        const r = params?.length ? await run(c, sql, params) : await c.query(sql);
        return (Array.isArray(r) ? r : [r]).map((x: QueryResult) => ({
          command: x.command,
          rowCount: x.rowCount,
          ...(x.rows?.length ? { rows: x.rows.slice(0, 20).map(plainRow) } : {}),
        }));
      });
    },
    async applyTemplate(botId: string, id: string) {
      const t = templateById(id);
      if (!t)
        throw new PluginError(
          "NOT_FOUND",
          "There is no such template.",
          "Pick Tasks, Preferences or Notes.",
        );
      const schema = await ensure(botId);
      await assertRoom(schema);
      await asBot(botId, "write", (c) => c.query(t.sql));
      const [row] = await db
        .select({ templates: botDatabase.templates })
        .from(botDatabase)
        .where(eq(botDatabase.botId, botId));
      await db
        .update(botDatabase)
        .set({ templates: [...new Set([...(row?.templates ?? []), t.id])] })
        .where(eq(botDatabase.botId, botId));
      return { template: t.id, title: t.title };
    },
    /** One page of a table for the data viewer (newest first when the table has created_at or id). */
    async rows(botId: string, table: string, offset = 0, limit = 50) {
      const schema = await ensure(botId);
      return asBot(botId, "read", async (c) => {
        const t = await findTable(c, schema, table);
        const r = await run(
          c,
          `select * from ${ident(schema)}.${quoteName(t.name)}${orderOf(t)} limit $1 offset $2`,
          [Math.min(200, Math.max(1, limit)), Math.max(0, offset)],
        );
        return { table: t, rows: r.rows.map(plainRow), offset, total: t.rows };
      });
    },
    async exportJson(botId: string) {
      const schema = await ensure(botId);
      const slug = await slugOf(botId);
      const out = await asBot(botId, "read", async (c) => {
        const result: Record<
          string,
          { description: string | null; columns: Column[]; rows: unknown[] }
        > = {};
        for (const t of await tables(c, schema))
          result[t.name] = {
            description: t.description,
            columns: t.columns,
            rows: (
              await c.query(
                `select * from ${ident(schema)}.${quoteName(t.name)}${orderOf(t)} limit 50000`,
              )
            ).rows,
          };
        return result;
      });
      return { bot: slug, schema, exportedAt: new Date().toISOString(), tables: out };
    },
    async exportCsv(botId: string, table: string) {
      const schema = await ensure(botId);
      return asBot(botId, "read", async (c) => {
        const t = await findTable(c, schema, table);
        const r = await c.query(
          `select * from ${ident(schema)}.${quoteName(t.name)}${orderOf(t)} limit 50000`,
        );
        const names = r.fields.map((f) => f.name);
        return {
          name: t.name,
          csv: [
            names.map(csvCell).join(","),
            ...r.rows.map((row) => names.map((n) => csvCell(row[n])).join(",")),
          ].join("\r\n"),
        };
      });
    },
    /** Erases everything the bot saved: the schema is dropped and recreated empty (the role, slug and access switch stay). */
    async reset(botId: string) {
      const schema = schemaFor(await slugOf(botId));
      await locked(schema, async (c, su) => {
        await disconnect(c, schema);
        await c.query(`drop schema if exists ${ident(schema)} cascade`);
        await provision(c, schema, su);
        await c.query(
          "insert into bot_database (bot_id, schema_name, role_name) values ($1, $2, $2) on conflict (bot_id) do update set templates = '[]'::jsonb, reset_at = now()",
          [botId, schema],
        );
      });
      ready.set(botId, schema);
      return { reset: true };
    },
    /** Removes the schema and the role entirely (a later use provisions a fresh, empty one). */
    async drop(botId: string) {
      const schema = schemaFor(await slugOf(botId));
      await locked(schema, async (c) => {
        await disconnect(c, schema);
        await c.query(`drop schema if exists ${ident(schema)} cascade`);
        if ((await c.query("select 1 from pg_roles where rolname = $1", [schema])).rowCount) {
          await c.query(`drop owned by ${ident(schema)}`);
          await c.query(`drop role ${ident(schema)}`);
        }
        await c.query("delete from bot_database where bot_id = $1", [botId]);
      });
      ready.delete(botId);
    },
    async close() {
      for (const role of pools.keys()) close(role);
    },
  };
}
export type BotDatabase = ReturnType<typeof createBotDatabase>;

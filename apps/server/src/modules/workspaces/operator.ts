// What the person who runs the server does with whole workspaces (docs/decisions/workspaces.md, "Export / delete" and "Quotas"): see
// them all with what they use, set their limits, suspend one, take a copy of one, and delete one. Root sees names and numbers here,
// never what is inside a workspace; a copy is the owner's to take, or root's for a workspace that is being closed.
import { rm } from "node:fs/promises";
import { tenant, type Database } from "@zetta/db";
import { and, asc, eq, sql } from "@zetta/db/query";
import { setting } from "@zetta/db/schema/settings";
import { invitationGrant, workspace, workspaceMember } from "@zetta/db/schema/workspaces";
import { accountFolder } from "../engine-accounts/adapters";
import { AccessError, type ActiveActor } from "../identity/access";
import type { Quotas, Quota } from "./quotas";
import { WorkspaceError } from "./service";

/** Tables that carry `workspace_id` but belong to every workspace's bookkeeping, not to one workspace's data. */
const BOOKKEEPING = new Set([
  "workspace",
  "workspace_member",
  "invitation_grant",
  "workspace_quota",
  "usage_counter",
]);
/** Never copied out: the sealed secrets themselves. A copy says which connections there are, not what they hold. */
const SECRET_TABLES = new Set(["connection_credential", "connection_mutation_receipt"]);

type Fk = {
  child: string;
  columns: string[];
  parent: string;
  /** Every column of the key may be empty: the reference can be cleared instead of deleting the row. */
  nullable: boolean;
};

type Audit = (
  userId: string,
  event: { kind: "workspace"; outcome: "ok"; subjectId: string; detail: string },
) => void;

export function createOperator(db: Database, deps: { quotas: Quotas; audit?: Audit }) {
  const requireRoot = (actor: ActiveActor) => {
    if (actor.isRoot !== true) throw new AccessError("ACCESS_DENIED");
  };
  const record = (actor: ActiveActor, subjectId: string, detail: string) =>
    deps.audit?.(actor.userId, { kind: "workspace", outcome: "ok", subjectId, detail });

  const first = async () =>
    (
      await db
        .select({ id: workspace.id })
        .from(workspace)
        .orderBy(asc(workspace.createdAt), asc(workspace.id))
        .limit(1)
    )[0]?.id;

  async function found(id: string) {
    const [row] = await db.select().from(workspace).where(eq(workspace.id, id));
    if (!row || row.status === "deleted")
      throw new WorkspaceError("NOT_FOUND", "There is no such workspace.");
    return row;
  }

  /** The tables of one workspace's data, from the catalog: every table with the column, but the bookkeeping. */
  async function dataTables() {
    const rows = await db.execute<{ name: string }>(sql`
      select table_name as name from information_schema.columns
      where table_schema = 'zetta' and column_name = 'workspace_id' order by 1`);
    return rows.rows.map((r) => r.name).filter((name) => !BOOKKEEPING.has(name));
  }

  /** Every foreign key between tables of the schema, with whether all its columns may be empty. */
  async function foreignKeys(): Promise<Fk[]> {
    const rows = await db.execute<{
      child: string;
      parent: string;
      columns: string[];
      nullable: boolean;
    }>(sql`
      select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
        -- text[]: the driver reads a name[] as one string.
        array_agg(a.attname::text order by k.ord) as columns,
        bool_and(not a.attnotnull) as nullable
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace and n.nspname = 'zetta'
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f'
      group by c.oid, c.conrelid, c.confrelid`);
    const bare = (name: string) => name.replace(/^zetta\./, "").replace(/"/g, "");
    return rows.rows.map((r) => ({ ...r, child: bare(r.child), parent: bare(r.parent) }));
  }

  /** Children before their parents, by the keys that cannot be cleared. A cycle of such keys is refused: nothing is deleted. */
  function deleteOrder(tables: string[], fks: Fk[]) {
    const left = new Set(tables);
    const order: string[] = [];
    const blocking = fks.filter(
      (f) => !f.nullable && left.has(f.child) && left.has(f.parent) && f.child !== f.parent,
    );
    while (left.size) {
      const next = [...left].filter(
        (t) => !blocking.some((f) => f.parent === t && f.child !== t && left.has(f.child)),
      );
      if (!next.length)
        throw new Error(`these tables point at each other: ${[...left].join(", ")}`);
      for (const t of next) {
        order.push(t);
        left.delete(t);
      }
    }
    return order;
  }

  const quoted = (name: string) => `zetta."${name.replace(/"/g, "")}"`;
  const column = (name: string) => `"${name.replace(/"/g, "")}"`;

  return {
    /** Every workspace with its people, what it used this month and what it may use. Root only. */
    async list(actor: ActiveActor) {
      requireRoot(actor);
      const own = await first();
      const rows = await db
        .select({
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          status: workspace.status,
          createdAt: workspace.createdAt,
          people: sql<number>`(select count(*)::int from ${workspaceMember} m where m.workspace_id = ${workspace.id} and m.status = 'active')`,
        })
        .from(workspace)
        .where(sql`${workspace.status} <> 'deleted'`)
        .orderBy(asc(workspace.createdAt), asc(workspace.id));
      return Promise.all(
        rows.map(async (r) => ({
          ...r,
          own: r.id === own,
          usage: await deps.quotas.usage(r.id),
          quota: await deps.quotas.quota(r.id),
        })),
      );
    },

    async setQuota(actor: ActiveActor, id: string, limits: Quota) {
      requireRoot(actor);
      await found(id);
      const quota = await deps.quotas.setQuota(id, limits, actor.userId);
      record(actor, id, "quota");
      return quota;
    },

    /** Suspends a workspace (nobody works in it, nothing runs in it) or lets it run again. Never root's own. */
    async setStatus(actor: ActiveActor, id: string, status: "active" | "suspended") {
      requireRoot(actor);
      const row = await found(id);
      if (id === (await first()))
        throw new WorkspaceError("NOT_ALLOWED", "Your own workspace always runs.");
      if (row.status === "deleting")
        throw new WorkspaceError("NOT_ALLOWED", "This workspace is being deleted.");
      await db.update(workspace).set({ status }).where(eq(workspace.id, id));
      record(actor, id, status);
      return { id, status };
    },

    /**
     * A copy of everything in a workspace's tables, one JSON line per row (`{"table":…,"row":…}`), gzipped. Read through the wall, as
     * that workspace: it cannot hold another's rows. Secrets go out as which connections there are, never what they hold. Its owner's to
     * take, or root's.
     */
    async export(actor: ActiveActor, id: string) {
      const row = await found(id);
      const owner = actor.workspaceId === id && actor.role === "owner";
      if (!owner && actor.isRoot !== true) throw new AccessError("ACCESS_DENIED");
      const tables = (await dataTables()).filter((t) => !SECRET_TABLES.has(t));
      record(actor, id, "exported");
      const encoder = new TextEncoder();
      const lines = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({ workspace: { id: row.id, slug: row.slug, name: row.name }, exportedAt: new Date().toISOString() })}\n`,
              ),
            );
            for (const table of tables) {
              const rows = await tenant.run(id, () =>
                db.execute(sql.raw(`select * from ${quoted(table)} where workspace_id = '${id}'`)),
              );
              for (const r of rows.rows)
                controller.enqueue(encoder.encode(`${JSON.stringify({ table, row: r })}\n`));
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return {
        name: `${row.slug}-${new Date().toISOString().slice(0, 10)}.ndjson.gz`,
        body: lines.pipeThrough(
          new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
        ),
      };
    },

    /**
     * Deletes a workspace and everything in it. It is closed at once (nobody stands in it, nothing runs in it), then its rows go, children
     * first, in the order the database's own keys give; references that may be empty are cleared first, which also breaks the cycles.
     * The workspace row stays as a tombstone, marked deleted. Never root's own. Root only.
     */
    async remove(actor: ActiveActor, id: string) {
      requireRoot(actor);
      await found(id);
      if (id === (await first()))
        throw new WorkspaceError("NOT_ALLOWED", "Your own workspace cannot be deleted.");
      await db.update(workspace).set({ status: "deleting" }).where(eq(workspace.id, id));
      record(actor, id, "deleting");
      const tables = await dataTables();
      const data = new Set(tables);
      const fks = await foreignKeys();
      const order = deleteOrder(tables, fks);
      const folders = await tenant.run(id, () =>
        db.execute<{ id: string }>(sql`select id from engine_account where workspace_id = ${id}`),
      );
      await tenant.run(id, () =>
        db.transaction(async (tx) => {
          // References that may be empty, inside the workspace: cleared, so no row waits for another.
          for (const f of fks.filter((k) => k.nullable && data.has(k.child) && data.has(k.parent)))
            await tx.execute(
              sql.raw(
                `update ${quoted(f.child)} set ${f.columns.map((c) => `${column(c)} = null`).join(", ")} where workspace_id = '${id}' and (${f.columns.map((c) => `${column(c)} is not null`).join(" or ")})`,
              ),
            );
          // What the shared tables hold of it: cleared where it may be empty, removed where it may not.
          for (const f of fks.filter(
            (k) => !data.has(k.child) && data.has(k.parent) && k.child !== "workspace",
          )) {
            const inside = `(select id from ${quoted(f.parent)} where workspace_id = '${id}')`;
            if (f.columns.length !== 1) continue;
            await tx.execute(
              sql.raw(
                f.nullable
                  ? `update ${quoted(f.child)} set ${column(f.columns[0]!)} = null where ${column(f.columns[0]!)} in ${inside}`
                  : `delete from ${quoted(f.child)} where ${column(f.columns[0]!)} in ${inside}`,
              ),
            );
          }
          for (const table of order)
            await tx.execute(sql.raw(`delete from ${quoted(table)} where workspace_id = '${id}'`));
          await tx.delete(invitationGrant).where(eq(invitationGrant.workspaceId, id));
          await tx
            .delete(setting)
            .where(and(eq(setting.scopeKind, "workspace"), eq(setting.scopeId, id)));
          // Its people stay on record as removed: someone who had a place and lost it stands nowhere, never in another workspace.
          await tx
            .update(workspaceMember)
            .set({
              status: "removed",
              removedAt: sql`clock_timestamp()`,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.status, "active")));
          await tx.update(workspace).set({ status: "deleted" }).where(eq(workspace.id, id));
        }),
      );
      for (const f of folders.rows)
        await rm(accountFolder(f.id), { recursive: true, force: true }).catch(() => undefined);
      record(actor, id, "deleted");
      return { id, status: "deleted" as const };
    },
  };
}
export type Operator = ReturnType<typeof createOperator>;

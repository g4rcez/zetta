// Background work runs for one workspace at a time (packages/db/src/tenant.ts): what a scheduler finds due, and what it then does, is that
// workspace's. A unit of work needs no change to run this way: its own queries see only the workspace it runs for.
import { tenant, type Database } from "@zetta/db";
import { asc, eq } from "@zetta/db/query";
import { workspace } from "@zetta/db/schema/workspaces";

/** The workspaces that run work now. */
export async function activeWorkspaces(db: Pick<Database, "select">) {
  const rows = await tenant.none(() =>
    db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.status, "active"))
      .orderBy(asc(workspace.createdAt), asc(workspace.id)),
  );
  return rows.map((r) => r.id);
}

/**
 * Runs `work` once for each active workspace, one after the other, each inside its own. A workspace whose run fails does not stop the
 * others; the first failure is thrown once all have run, for the caller's own report.
 */
export async function forEachWorkspace(db: Pick<Database, "select">, work: () => unknown) {
  let failure: unknown;
  for (const id of await activeWorkspaces(db)) {
    try {
      await tenant.run(id, work);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

/**
 * A handle whose methods are called later from outside any request (a socket's messages): each call works in `workspaceId`. With none,
 * the handle as it is.
 */
export function boundTo<T extends object>(workspaceId: string | undefined, handle: T): T {
  if (!workspaceId) return handle;
  return new Proxy(handle, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function"
        ? (...args: unknown[]) =>
            tenant.run(workspaceId, () =>
              (value as (...a: unknown[]) => unknown).apply(target, args),
            )
        : value;
    },
  });
}

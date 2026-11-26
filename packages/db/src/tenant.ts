// The workspace a piece of work belongs to, carried with it through every await (docs/decisions/workspaces.md, "Context plumbing").
//
// Every connection the pool hands out first gets `app.workspace_id` set to that workspace (index.ts). The column default of every
// workspace table and its row rule read the same setting, so a query sees and writes only the rows of the workspace it runs for, and
// an insert needs no change to land in the right one.
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";

/**
 * A request starts with an empty slot that the person's identity fills once it is known (`claim`), so everything the request does
 * after that, including work it leaves running, runs for that person's workspace. Background work starts its own (`run`).
 */
type Slot = { workspaceId: string | undefined; scan: boolean; requested?: string | undefined };

const store = new AsyncLocalStorage<Slot>();

/** The value of `app.workspace_id` that lets a query read the routing tables of every workspace, and nothing else (see `scan`). */
export const SCAN_ALL = "*";
/** The setting of work that stands in no workspace: it matches no row. */
const NOWHERE = "";

/**
 * Runs `work` inside `slot`. A query builder is lazy: it starts when it is awaited, and the caller awaits it after `run` has returned,
 * outside the slot. So a result that can be awaited is started here, inside it, and handed back as a promise.
 */
function within<T>(slot: Slot, work: () => T): T {
  return store.run(slot, () => started(work()));
}

/** A result that can be awaited and has not started (anything but a promise), started now; anything else as it is. */
function started<T>(result: T): T {
  const lazy = result as unknown as PromiseLike<unknown> | null | undefined;
  if (result instanceof Promise || !lazy || typeof lazy.then !== "function") return result;
  return new Promise((resolve, reject) => lazy.then(resolve, reject)) as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid = (workspaceId: string) => {
  if (!UUID.test(workspaceId)) throw new Error("not a workspace id");
  return workspaceId;
};

export const tenant = {
  /** Runs `work` for one workspace: every query it makes, now or later, is that workspace's. */
  run<T>(workspaceId: string, work: () => T): T {
    return within({ workspaceId: valid(workspaceId), scan: false }, work);
  },

  /**
   * Runs `work` with no workspace yet: a request, before it knows whose it is. `claim` fills it in. Queries before that reach only the
   * tables every workspace shares (people, sessions, the server's own settings). `requested` is the workspace the request names.
   */
  open<T>(work: () => T, requested?: string): T {
    return within({ workspaceId: undefined, scan: false, requested }, work);
  },

  /**
   * The workspace the request asked to work in (its slug or id, from the `X-Zetta-Workspace` header or `?w=`), not checked yet: the
   * identity lookup takes it only for a person who is a member of it.
   */
  requested(): string | undefined {
    return store.getStore()?.requested;
  },

  /** The request now knows its workspace. Outside a request (a test, a start-up step) this does nothing. */
  claim(workspaceId: string) {
    const slot = store.getStore();
    if (slot && !slot.scan) slot.workspaceId = valid(workspaceId);
  },

  /**
   * The request's person stands in no workspace (theirs was deleted or suspended, or they have no place): it sees no workspace's rows and
   * writes none, instead of running where work with no workspace runs.
   */
  claimNowhere() {
    const slot = store.getStore();
    if (slot && !slot.scan) slot.workspaceId = NOWHERE;
  },

  /**
   * Like `claim`, only for a request that has no workspace yet: one that names its person some other way than a session (an MCP token).
   * A request that already works in a workspace keeps it, whoever else it then acts for.
   */
  claimIfOpen(workspaceId: string) {
    const slot = store.getStore();
    if (slot && !slot.scan && slot.workspaceId === undefined) slot.workspaceId = valid(workspaceId);
  },

  /**
   * Runs `work` to route what arrives from outside with no person signed in (a call to a number, a device, a webhook trigger): it reads
   * the few routing tables that allow it across every workspace (migration `workspace_wall_rules`), sees nothing in any other table, and
   * can write nothing. The work that follows runs in the row's own workspace (`claim`).
   */
  scan<T>(work: () => T): T {
    return within({ workspaceId: undefined, scan: true }, work);
  },

  /** Runs `work` outside any workspace, whatever the caller had: for timers started at boot, so they never keep a request's. */
  none<T>(work: () => T): T {
    return store.exit(() => started(work()));
  },

  /** The workspace of the work running now, if it has one. */
  current(): string | undefined {
    const id = store.getStore()?.workspaceId;
    return id === NOWHERE ? undefined : id;
  },

  /** What `app.workspace_id` is set to for the work running now: a workspace, every queue, or nothing (undefined). */
  setting(): string | undefined {
    const slot = store.getStore();
    if (!slot) return undefined;
    return slot.scan ? SCAN_ALL : slot.workspaceId;
  },
};

/**
 * Inside a transaction that is already open, writes for another workspace than the one the transaction started with: an invitation
 * that places a person in the workspace it is for, a step that creates a workspace's first rows. It holds until the transaction ends.
 */
export async function asWorkspace(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  workspaceId: string,
) {
  await tx.execute(sql`select set_config('app.workspace_id', ${valid(workspaceId)}, true)`);
}

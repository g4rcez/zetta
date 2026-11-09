import type { Database } from "@zetta/db";
import { and, eq, inArray, isNull, or, sql } from "@zetta/db/query";
import { appRecord, type AppToolManifest } from "@zetta/db/schema/apps";

/**
 * What an app keeps between calls. A tool declares the collections it uses; the server hands it the records as a snapshot with the call
 * and applies what the tool wrote in ONE transaction, only after the result was valid. A failed or invalid call writes nothing, and a
 * query cannot write. The tool never talks to the database.
 */
export const STORAGE_LIMITS = {
  /** All records a call gets, as JSON. */
  snapshotBytes: 1_000_000,
  /** One value. */
  valueBytes: 64_000,
  keyChars: 200,
  /** Writes in one call. */
  opsPerCall: 500,
  /** Records per person per app, and records in the shared part of an app. */
  recordsPerScope: 5_000,
  /** All values of one app. */
  bytesPerApp: 50_000_000,
} as const;

export class StorageError extends Error {
  constructor(
    readonly code: "STORAGE_TOO_LARGE" | "STORAGE_FULL" | "STORAGE_INVALID",
    message: string,
  ) {
    super(message);
  }
}

export type StorageOp =
  | { op: "put"; collection: string; key: string; value: unknown; bytes: number }
  | { op: "delete"; collection: string; key: string };
export type Snapshot = Record<string, Record<string, unknown>>;
type Declared = NonNullable<AppToolManifest["storage"]>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads the writes a tool reported and checks them against what it declared. Only the last write of a key counts. Throws StorageError
 * with a sentence for the person who wrote the app.
 */
export function checkOps(raw: unknown, declared: Declared | undefined): StorageOp[] {
  if (raw === undefined || raw === null) return [];
  const fail = (m: string) => new StorageError("STORAGE_INVALID", m);
  if (!Array.isArray(raw)) throw fail("The tool's storage writes have the wrong shape.");
  if (raw.length === 0) return [];
  if (!declared?.write) throw fail("The tool wrote storage but did not declare write access.");
  if (raw.length > STORAGE_LIMITS.opsPerCall)
    throw fail(`A call may write at most ${STORAGE_LIMITS.opsPerCall} records.`);
  const allowed = new Set([...declared.collections, ...declared.shared]);
  const last = new Map<string, StorageOp>();
  for (const o of raw) {
    if (
      !isRecord(o) ||
      (o.op !== "put" && o.op !== "delete") ||
      typeof o.collection !== "string" ||
      typeof o.key !== "string"
    )
      throw fail("The tool wrote a storage record the server cannot read.");
    if (!allowed.has(o.collection))
      throw fail(`The tool wrote the collection "${o.collection}", which it did not declare.`);
    if (o.key.length < 1 || o.key.length > STORAGE_LIMITS.keyChars)
      throw fail(`A storage key must be 1 to ${STORAGE_LIMITS.keyChars} characters.`);
    if (o.op === "delete") {
      last.set(`${o.collection}\u0000${o.key}`, {
        op: "delete",
        collection: o.collection,
        key: o.key,
      });
      continue;
    }
    const json = JSON.stringify(o.value ?? null);
    const bytes = Buffer.byteLength(json);
    if (bytes > STORAGE_LIMITS.valueBytes)
      throw fail(
        `A stored value may be at most ${STORAGE_LIMITS.valueBytes} bytes ("${o.key}" is ${bytes}).`,
      );
    last.set(`${o.collection}\u0000${o.key}`, {
      op: "put",
      collection: o.collection,
      key: o.key,
      value: JSON.parse(json),
      bytes,
    });
  }
  return [...last.values()];
}

/** The records a call may read: the caller's own in personal collections, everyone's in shared ones. */
export async function loadSnapshot(
  db: Database,
  appId: string,
  userId: string,
  declared: Declared | undefined,
): Promise<Snapshot> {
  if (!declared) return {};
  const names = [...declared.collections, ...declared.shared];
  if (names.length === 0) return {};
  // A collection is either personal or shared (the manifest forbids both), so each row is picked by its own scope.
  const scopes = [
    ...(declared.collections.length
      ? [and(inArray(appRecord.collection, declared.collections), eq(appRecord.userId, userId))]
      : []),
    ...(declared.shared.length
      ? [and(inArray(appRecord.collection, declared.shared), isNull(appRecord.userId))]
      : []),
  ];
  const where = and(eq(appRecord.appId, appId), or(...scopes));
  const [size] = await db
    .select({ bytes: sql<number>`coalesce(sum(${appRecord.bytes}), 0)::int` })
    .from(appRecord)
    .where(where);
  if ((size?.bytes ?? 0) > STORAGE_LIMITS.snapshotBytes)
    throw new StorageError(
      "STORAGE_TOO_LARGE",
      `The records this tool reads are ${size!.bytes} bytes; a call can carry ${STORAGE_LIMITS.snapshotBytes}. Delete some records or split the collection.`,
    );
  const rows = await db
    .select({ collection: appRecord.collection, key: appRecord.key, value: appRecord.value })
    .from(appRecord)
    .where(where);
  const out: Snapshot = Object.fromEntries(names.map((n) => [n, {}]));
  for (const r of rows) out[r.collection]![r.key] = r.value;
  return out;
}

/** Applies the writes of one call. Call it inside the transaction that records the call; it throws StorageError (and so rolls back) when a quota is passed. */
export async function applyOps(
  tx: Database,
  appId: string,
  userId: string,
  declared: Declared,
  ops: StorageOp[],
) {
  if (ops.length === 0) return;
  const shared = new Set(declared.shared);
  const owner = (c: string) => (shared.has(c) ? null : userId);
  for (const o of ops) {
    const who = owner(o.collection);
    if (o.op === "delete") {
      await tx
        .delete(appRecord)
        .where(
          and(
            eq(appRecord.appId, appId),
            who === null ? isNull(appRecord.userId) : eq(appRecord.userId, who),
            eq(appRecord.collection, o.collection),
            eq(appRecord.key, o.key),
          ),
        );
      continue;
    }
    await tx.execute(sql`
      insert into ${appRecord} (app_id, user_id, collection, key, value, bytes)
      values (${appId}, ${who}, ${o.collection}, ${o.key}, ${JSON.stringify(o.value)}::jsonb, ${o.bytes})
      on conflict (app_id, coalesce(user_id, ''), collection, key)
      do update set value = excluded.value, bytes = excluded.bytes, updated_at = now()`);
  }
  // Quotas after the writes, inside the same transaction: a pass over the limit undoes the whole call.
  const scopes = new Set(ops.map((o) => owner(o.collection)));
  for (const who of scopes) {
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appRecord)
      .where(
        and(
          eq(appRecord.appId, appId),
          who === null ? isNull(appRecord.userId) : eq(appRecord.userId, who),
        ),
      );
    if ((n?.n ?? 0) > STORAGE_LIMITS.recordsPerScope)
      throw new StorageError(
        "STORAGE_FULL",
        `${who === null ? "The shared part of this app" : "Your part of this app"} may hold ${STORAGE_LIMITS.recordsPerScope} records.`,
      );
  }
  const [total] = await tx
    .select({ bytes: sql<number>`coalesce(sum(${appRecord.bytes}), 0)::bigint` })
    .from(appRecord)
    .where(eq(appRecord.appId, appId));
  if (Number(total?.bytes ?? 0) > STORAGE_LIMITS.bytesPerApp)
    throw new StorageError("STORAGE_FULL", "This app has used all the storage it may have.");
}

/** What an app keeps, as numbers for the Data page. A record is `shared`, `mine` (the caller's) or `others` (owner only). */
export async function summarize(db: Database, appId: string, userId: string, owner: boolean) {
  const scope = sql<
    "shared" | "mine" | "others"
  >`(case when ${appRecord.userId} is null then 'shared' when ${appRecord.userId} = ${userId} then 'mine' else 'others' end)`.as(
    "scope",
  );
  return db
    .select({
      collection: appRecord.collection,
      scope,
      records: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${appRecord.bytes}), 0)::int`,
    })
    .from(appRecord)
    .where(
      owner
        ? eq(appRecord.appId, appId)
        : and(
            eq(appRecord.appId, appId),
            or(isNull(appRecord.userId), eq(appRecord.userId, userId)),
          ),
    )
    .groupBy(appRecord.collection, sql`scope`);
}

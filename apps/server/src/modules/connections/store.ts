import { uuidv7 } from "@zetta/core/uuid";
import { randomBytes } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, asc, eq, gt, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import {
  connection,
  connectionCredential,
  connectionKeyCheck,
  connectionMutationReceipt as receipt,
  connectionNonce,
  connectionUserKey,
} from "@zetta/db/schema/connections";
import { auditEvent } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { AccessError, requireOwned, type ActiveActor } from "../identity/access";
import {
  ConnectionStoreError,
  fail,
  metadata,
  ownerId,
  uuid,
  requireConnectionActor,
  parseCreate,
  parseList,
  parseOptions,
  parseReplace,
  parseRevoke,
  type ConnectionMetadata,
  type Mutation,
} from "./store-contract";
import { createStoreKeys } from "./store-keys";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
function fields(table: typeof connection | typeof receipt) {
  return {
    kind: table.kind,
    provider: table.provider,
    label: table.label,
    state: table.state,
    revision: table.revision,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    expiresAt: table.expiresAt,
    revokedAt: table.revokedAt,
  };
}
const selected = {
  id: connection.id,
  ...fields(connection),
  credentialVersion: connection.currentCredentialVersion,
};
const receiptSelected = {
  id: receipt.connectionId,
  ...fields(receipt),
  credentialVersion: receipt.credentialVersion,
};

/** Written in the same transaction as the change it records, so the trail cannot disagree with the data. */
const record = (tx: Transaction, owner: string, detail: "key_created" | "key_rotated" | "purged") =>
  tx
    .insert(auditEvent)
    .values({
      ownerUserId: owner,
      kind: "connection",
      outcome: "ok",
      botId: null,
      subjectId: null,
      detail,
    });
function trustedOwner(userId: string): string {
  const parsed = ownerId.safeParse(userId);
  return parsed.success ? parsed.data : fail("not-found");
}

async function member(tx: Transaction, actor: ActiveActor): Promise<void> {
  const [account] = await tx
    .select({ userId: user.id })
    .from(user)
    .where(eq(user.id, actor.userId))
    .for("key share");
  if (account?.userId !== actor.userId) throw new AccessError("ACCESS_DENIED");
  const [row] = await tx
    .select({ status: membership.status })
    .from(membership)
    .where(eq(membership.userId, actor.userId))
    .for("update");
  if (row?.status !== "active") throw new AccessError("ACCESS_DENIED");
}

export async function createConnectionStore(
  db: Pick<Database, "transaction">,
  options: unknown,
  nonceSource?: (size: number) => Uint8Array,
) {
  const { configuration, allowedProviders, initializeEmpty } = parseOptions(options);
  const keys = createStoreKeys(configuration, nonceSource);
  const keyId = configuration.keyId;
  async function keyCheck(tx: Transaction) {
    const [row] = await tx
      .select()
      .from(connectionKeyCheck)
      .where(eq(connectionKeyCheck.id, 1))
      .for("update");
    if (!row || row.encryptionCount < 1 || row.encryptionCount > 1000000)
      return fail("unavailable");
    const { envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext } = row;
    keys.verifyKeyCheck({ envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext });
    return row;
  }
  // The ledger key id is the envelope's own: the deployment key for the key check and user-key wraps, `u<n>` for credentials.
  async function reserve(
    tx: Transaction,
    make: () => ReturnType<typeof keys.seal>,
    identity: { connectionId: string; credentialVersion: number } | "key-check" | "user-key",
    now: Date,
  ) {
    const credential = typeof identity === "object" ? identity : null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const envelope = make();
      const [reserved] = await tx
        .insert(connectionNonce)
        .values({
          keyId: envelope.keyId,
          nonce: Buffer.from(envelope.nonce),
          purpose: typeof identity === "object" ? "credential" : identity,
          connectionId: credential?.connectionId ?? null,
          credentialVersion: credential?.credentialVersion ?? null,
          createdAt: now,
        })
        .onConflictDoNothing({ target: [connectionNonce.keyId, connectionNonce.nonce] })
        .returning({ keyId: connectionNonce.keyId });
      if (reserved)
        return {
          ...envelope,
          nonce: Buffer.from(envelope.nonce),
          tag: Buffer.from(envelope.tag),
          ciphertext: Buffer.from(envelope.ciphertext),
        };
    }
    return fail("unavailable");
  }
  /**
   * The owner's unwrapped user key. `create` is set only on write paths: the first write creates the key, wrapped under the deployment key.
   * The caller owns the returned buffer and must zero it.
   */
  async function userKey(
    tx: Transaction,
    owner: string,
    create: { now: Date; check: { encryptionCount: number } } | null,
  ) {
    const [row] = await tx
      .select()
      .from(connectionUserKey)
      .where(eq(connectionUserKey.ownerUserId, owner))
      .for("update");
    if (row) {
      const { envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext } = row;
      const dek = keys.unwrapUserKey(
        { envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext },
        { ownerUserId: owner, keyVersion: row.keyVersion },
      );
      return { dek, keyVersion: row.keyVersion, encryptionCount: row.encryptionCount };
    }
    if (!create) return fail("unavailable");
    if (create.check.encryptionCount >= 1000000) return fail("key-capacity");
    const dek = randomBytes(32);
    try {
      const envelope = await reserve(
        tx,
        () => keys.wrapUserKey(dek, { ownerUserId: owner, keyVersion: 1 }),
        "user-key",
        create.now,
      );
      await tx
        .insert(connectionUserKey)
        .values({
          ownerUserId: owner,
          keyVersion: 1,
          ...envelope,
          noncePurpose: "user-key",
          encryptionCount: 0,
          createdAt: create.now,
        });
      create.check.encryptionCount += 1;
      await tx
        .update(connectionKeyCheck)
        .set({ encryptionCount: create.check.encryptionCount })
        .where(eq(connectionKeyCheck.id, 1));
      await record(tx, owner, "key_created");
    } catch (error) {
      dek.fill(0);
      throw error;
    }
    return { dek, keyVersion: 1, encryptionCount: 0 };
  }
  try {
    await db.transaction(
      async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(2053461108, 7002)`);
        const [existing] = await tx
          .select({ id: connectionKeyCheck.id })
          .from(connectionKeyCheck)
          .limit(1);
        if (!existing) {
          if (!initializeEmpty) return fail("unavailable");
          for (const table of [
            connection,
            connectionCredential,
            connectionNonce,
            receipt,
            connectionKeyCheck,
            connectionUserKey,
          ]) {
            const [row] = await tx.select({ count: sql<string>`count(*)::text` }).from(table);
            if (row?.count !== "0") return fail("unavailable");
          }
          const envelope = await reserve(tx, keys.createKeyCheck, "key-check", new Date());
          await tx
            .insert(connectionKeyCheck)
            .values({
              id: 1,
              ...envelope,
              noncePurpose: "key-check",
              encryptionCount: 1,
              createdAt: sql`clock_timestamp()`,
            });
        }
        const check = await keyCheck(tx);
        // The key check counts only deployment-key encryptions (itself and user-key wraps); every other ledger row must belong to a user key `u<n>`.
        const [counts] = await tx
          .select({
            matching: sql<string>`count(*) filter (where ${connectionNonce.keyId} = ${keyId})::text`,
            strays: sql<string>`count(*) filter (where ${connectionNonce.keyId} <> ${keyId} and ${connectionNonce.keyId} !~ '^u[0-9]+$')::text`,
          })
          .from(connectionNonce);
        if (!counts || Number(counts.matching) !== check.encryptionCount || counts.strays !== "0")
          return fail("unavailable");
        const [nonce] = await tx
          .select({ purpose: connectionNonce.purpose })
          .from(connectionNonce)
          .where(and(eq(connectionNonce.keyId, keyId), eq(connectionNonce.nonce, check.nonce)))
          .limit(1);
        if (nonce?.purpose !== "key-check") return fail("unavailable");
        // Credentials written before per-user keys are sealed under the deployment key: move them under their owner's key, in this one transaction.
        const legacy = await tx
          .select()
          .from(connectionCredential)
          .where(eq(connectionCredential.keyId, keyId))
          .orderBy(
            asc(connectionCredential.ownerUserId),
            asc(connectionCredential.connectionId),
            asc(connectionCredential.credentialVersion),
          )
          .for("update");
        const owners = new Map<string, Awaited<ReturnType<typeof userKey>>>();
        const now = new Date();
        try {
          for (const row of legacy) {
            let owned = owners.get(row.ownerUserId);
            if (!owned) {
              owned = await userKey(tx, row.ownerUserId, { now, check });
              owners.set(row.ownerUserId, owned);
            }
            if (owned.encryptionCount >= 1000000) return fail("key-capacity");
            const context = {
              ownerUserId: row.ownerUserId,
              connectionId: row.connectionId,
              kind: "api-key",
              credentialVersion: row.credentialVersion,
            } as const;
            const {
              envelopeVersion,
              algorithm,
              keyId: storedKeyId,
              nonce: storedNonce,
              tag,
              ciphertext,
            } = row;
            const plaintext = keys.open(
              {
                envelopeVersion,
                algorithm,
                keyId: storedKeyId,
                nonce: storedNonce,
                tag,
                ciphertext,
              },
              context,
            );
            const sealer = keys.forUserKey(owned.dek, owned.keyVersion);
            try {
              const sealed = await reserve(
                tx,
                () => sealer.seal(plaintext, context),
                { connectionId: row.connectionId, credentialVersion: row.credentialVersion },
                now,
              );
              await tx
                .update(connectionCredential)
                .set(sealed)
                .where(
                  and(
                    eq(connectionCredential.connectionId, row.connectionId),
                    eq(connectionCredential.credentialVersion, row.credentialVersion),
                  ),
                );
              owned.encryptionCount += 1;
            } finally {
              plaintext.fill(0);
              sealer.dispose();
            }
          }
          for (const [owner, owned] of owners)
            await tx
              .update(connectionUserKey)
              .set({ encryptionCount: owned.encryptionCount })
              .where(eq(connectionUserKey.ownerUserId, owner));
        } finally {
          for (const owned of owners.values()) owned.dek.fill(0);
        }
      },
      { isolationLevel: "read committed" },
    );
  } catch {
    return fail("unavailable");
  }

  async function mutate(actor: ActiveActor, mutation: Mutation): Promise<ConnectionMetadata> {
    try {
      const owner = requireConnectionActor(actor);
      const requestMac = keys.requestMac(owner, mutation);
      return await db.transaction(
        async (tx) => {
          await member(tx, actor);
          const [prior] = await tx
            .select({ ...receiptSelected, requestMac: receipt.requestMac })
            .from(receipt)
            .where(
              and(
                eq(receipt.ownerUserId, owner),
                eq(receipt.operationId, mutation.input.operationId),
              ),
            )
            .limit(1);
          if (prior) {
            if (!keys.sameMac(prior.requestMac, requestMac)) return fail("conflict");
            const { requestMac: _privateMac, ...safe } = prior;
            return metadata(safe);
          }
          let current: ConnectionMetadata | undefined;
          if (mutation.operation !== "create-api-key") {
            const [row] = await tx
              .select({ ...selected, ownerUserId: connection.ownerUserId })
              .from(connection)
              .where(and(eq(connection.id, mutation.input.id), eq(connection.ownerUserId, owner)))
              .for("update");
            const { ownerUserId: _owner, ...safe } = requireOwned(actor, row);
            current = metadata(safe);
            if (current.revision !== mutation.input.expectedRevision || current.state !== "active")
              return fail("conflict");
            if (
              current.revision === 2147483647 ||
              (mutation.operation === "replace-api-key" && current.credentialVersion === 2147483647)
            )
              return fail("conflict");
          }
          const check = await keyCheck(tx);
          const [clock] = await tx
            .select({ now: sql<string>`floor(extract(epoch from clock_timestamp()) * 1000)::text` })
            .from(connectionKeyCheck)
            .where(eq(connectionKeyCheck.id, 1));
          const nowMs = Number(clock?.now);
          if (!Number.isSafeInteger(nowMs) || !Number.isFinite(new Date(nowMs).getTime()))
            return fail("unavailable");
          const now = new Date(nowMs);
          let result: ConnectionMetadata;
          if (mutation.operation === "revoke") {
            if (!current) return fail("unavailable");
            const [row] = await tx
              .update(connection)
              .set({
                state: "revoked",
                revision: current.revision + 1,
                updatedAt: now,
                revokedAt: now,
              })
              .where(and(eq(connection.id, current.id), eq(connection.ownerUserId, owner)))
              .returning(selected);
            result = metadata(row);
          } else {
            const input = mutation.input;
            if (input.expiresAt !== null && input.expiresAt <= nowMs) return fail("invalid-input");
            if (
              mutation.operation === "create-api-key" &&
              !allowedProviders.has(mutation.input.provider)
            )
              return fail("invalid-input");
            const id = current?.id ?? uuidv7();
            const credentialVersion = (current?.credentialVersion ?? 0) + 1;
            const owned = await userKey(tx, owner, { now, check });
            const sealer = keys.forUserKey(owned.dek, owned.keyVersion);
            let envelope: Awaited<ReturnType<typeof reserve>>;
            try {
              if (owned.encryptionCount >= 1000000) return fail("key-capacity");
              envelope = await reserve(
                tx,
                () =>
                  sealer.seal(input.secret, {
                    ownerUserId: owner,
                    connectionId: id,
                    kind: "api-key",
                    credentialVersion,
                  }),
                { connectionId: id, credentialVersion },
                now,
              );
            } finally {
              sealer.dispose();
              owned.dek.fill(0);
            }
            const insertVersion = () =>
              tx
                .insert(connectionCredential)
                .values({
                  connectionId: id,
                  credentialVersion,
                  ownerUserId: owner,
                  kind: "api-key",
                  ...envelope,
                  createdAt: now,
                });
            if (mutation.operation === "create-api-key") {
              const [row] = await tx
                .insert(connection)
                .values({
                  id,
                  ownerUserId: owner,
                  kind: "api-key",
                  provider: mutation.input.provider,
                  label: mutation.input.label,
                  state: "active",
                  revision: 1,
                  currentCredentialVersion: 1,
                  createdAt: now,
                  updatedAt: now,
                  revokedAt: null,
                  expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
                })
                .returning(selected);
              result = metadata(row);
              await insertVersion();
            } else {
              if (!current) return fail("unavailable");
              await insertVersion();
              const [row] = await tx
                .update(connection)
                .set({
                  revision: current.revision + 1,
                  currentCredentialVersion: credentialVersion,
                  updatedAt: now,
                  expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
                })
                .where(and(eq(connection.id, id), eq(connection.ownerUserId, owner)))
                .returning(selected);
              result = metadata(row);
            }
            await tx
              .update(connectionUserKey)
              .set({ encryptionCount: owned.encryptionCount + 1 })
              .where(eq(connectionUserKey.ownerUserId, owner));
          }
          const { id: resultId, ...resultFields } = result;
          await tx
            .insert(receipt)
            .values({
              ...resultFields,
              connectionId: resultId,
              ownerUserId: owner,
              operationId: mutation.input.operationId,
              operation: mutation.operation,
              expectedRevision:
                mutation.operation === "create-api-key" ? null : mutation.input.expectedRevision,
              requestMac,
              createdAt: new Date(result.createdAt),
              updatedAt: new Date(result.updatedAt),
              expiresAt: result.expiresAt === null ? null : new Date(result.expiresAt),
              revokedAt: result.revokedAt === null ? null : new Date(result.revokedAt),
            });
          return result;
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (error instanceof AccessError || error instanceof ConnectionStoreError) throw error;
      return fail("outcome-unknown");
    } finally {
      if (mutation.operation !== "revoke") mutation.input.secret.fill(0);
    }
  }
  return Object.freeze({
    createApiKey: (actor: ActiveActor, input: unknown) =>
      mutate(actor, { operation: "create-api-key", input: parseCreate(input) }),
    replaceApiKey: (actor: ActiveActor, input: unknown) =>
      mutate(actor, { operation: "replace-api-key", input: parseReplace(input) }),
    revoke: (actor: ActiveActor, input: unknown) =>
      mutate(actor, { operation: "revoke", input: parseRevoke(input) }),
    /**
     * Server-side only: returns the decrypted secret for one active, unexpired connection of the actor, or fails closed.
     * The caller must zero the returned buffer after use. Revoked, expired, foreign or missing connections all fail the same way.
     */
    async resolveForExecution(actor: ActiveActor, id: string): Promise<Buffer> {
      const owner = requireConnectionActor(actor);
      if (!uuid.safeParse(id).success) return fail("not-found");
      try {
        return await db.transaction(
          async (tx) => {
            await member(tx, actor);
            const [row] = await tx
              .select({ ...selected, ownerUserId: connection.ownerUserId })
              .from(connection)
              .where(and(eq(connection.id, id), eq(connection.ownerUserId, owner)));
            if (
              !row ||
              row.state !== "active" ||
              (row.expiresAt && row.expiresAt.getTime() <= Date.now())
            )
              return fail("not-found");
            const [cred] = await tx
              .select()
              .from(connectionCredential)
              .where(
                and(
                  eq(connectionCredential.connectionId, id),
                  eq(connectionCredential.credentialVersion, row.credentialVersion),
                  eq(connectionCredential.ownerUserId, owner),
                ),
              );
            if (!cred) return fail("unavailable");
            const { envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext } = cred;
            const owned = await userKey(tx, owner, null);
            const opener = keys.forUserKey(owned.dek, owned.keyVersion);
            try {
              return opener.open(
                { envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext },
                {
                  ownerUserId: owner,
                  connectionId: id,
                  kind: "api-key",
                  credentialVersion: row.credentialVersion,
                },
              );
            } finally {
              opener.dispose();
              owned.dek.fill(0);
            }
          },
          { isolationLevel: "read committed" },
        );
      } catch (error) {
        if (error instanceof AccessError || error instanceof ConnectionStoreError) throw error;
        return fail("unavailable");
      }
    },
    /**
     * Trusted callers only (the operator CLI); not reachable from a route. Moves every credential of one user under a new random user key
     * (key version + 1) and replaces the wrapped key. One transaction under the user's membership lock, so a read or write never sees a
     * half-rotated user. A credential that does not open under the current key aborts the whole rotation.
     */
    async rotateUserKey(userId: string): Promise<{ keyVersion: number; credentials: number }> {
      const owner = trustedOwner(userId);
      try {
        return await db.transaction(
          async (tx) => {
            await tx
              .select({ userId: membership.userId })
              .from(membership)
              .where(eq(membership.userId, owner))
              .for("update");
            const [existing] = await tx
              .select({ owner: connectionUserKey.ownerUserId })
              .from(connectionUserKey)
              .where(eq(connectionUserKey.ownerUserId, owner));
            if (!existing) return fail("not-found");
            const check = await keyCheck(tx);
            const current = await userKey(tx, owner, null);
            const next = randomBytes(32);
            const keyVersion = current.keyVersion + 1;
            const now = new Date();
            const oldSealer = keys.forUserKey(current.dek, current.keyVersion);
            const newSealer = keys.forUserKey(next, keyVersion);
            try {
              if (keyVersion > 2147483647 || check.encryptionCount >= 1000000)
                return fail("key-capacity");
              const rows = await tx
                .select()
                .from(connectionCredential)
                .where(eq(connectionCredential.ownerUserId, owner))
                .orderBy(
                  asc(connectionCredential.connectionId),
                  asc(connectionCredential.credentialVersion),
                )
                .for("update");
              for (const row of rows) {
                const context = {
                  ownerUserId: owner,
                  connectionId: row.connectionId,
                  kind: "api-key",
                  credentialVersion: row.credentialVersion,
                } as const;
                const {
                  envelopeVersion,
                  algorithm,
                  keyId: storedKeyId,
                  nonce: storedNonce,
                  tag,
                  ciphertext,
                } = row;
                const plaintext = oldSealer.open(
                  {
                    envelopeVersion,
                    algorithm,
                    keyId: storedKeyId,
                    nonce: storedNonce,
                    tag,
                    ciphertext,
                  },
                  context,
                );
                try {
                  const sealed = await reserve(
                    tx,
                    () => newSealer.seal(plaintext, context),
                    { connectionId: row.connectionId, credentialVersion: row.credentialVersion },
                    now,
                  );
                  await tx
                    .update(connectionCredential)
                    .set(sealed)
                    .where(
                      and(
                        eq(connectionCredential.connectionId, row.connectionId),
                        eq(connectionCredential.credentialVersion, row.credentialVersion),
                      ),
                    );
                } finally {
                  plaintext.fill(0);
                }
              }
              const wrapped = await reserve(
                tx,
                () => keys.wrapUserKey(next, { ownerUserId: owner, keyVersion }),
                "user-key",
                now,
              );
              await tx
                .update(connectionUserKey)
                .set({ keyVersion, ...wrapped, encryptionCount: rows.length })
                .where(eq(connectionUserKey.ownerUserId, owner));
              await tx
                .update(connectionKeyCheck)
                .set({ encryptionCount: check.encryptionCount + 1 })
                .where(eq(connectionKeyCheck.id, 1));
              await record(tx, owner, "key_rotated");
              return { keyVersion, credentials: rows.length };
            } finally {
              oldSealer.dispose();
              newSealer.dispose();
              current.dek.fill(0);
              next.fill(0);
            }
          },
          { isolationLevel: "read committed" },
        );
      } catch (error) {
        if (error instanceof AccessError || error instanceof ConnectionStoreError) throw error;
        return fail("unavailable");
      }
    },
    /**
     * Trusted callers only (a future user-deletion flow); not reachable from a route. Deletes the user key first, which makes the
     * credentials unreadable, then every connection row of the user. The nonce ledger keeps its tombstones (no personal data).
     * Rows that reference a connection with RESTRICT (bot bindings) must be removed by the caller first.
     */
    async purgeOwner(
      userId: string,
    ): Promise<{ connections: number; credentials: number; userKey: boolean }> {
      const owner = trustedOwner(userId);
      try {
        return await db.transaction(
          async (tx) => {
            await tx
              .select({ userId: membership.userId })
              .from(membership)
              .where(eq(membership.userId, owner))
              .for("update");
            const keyRows = await tx
              .delete(connectionUserKey)
              .where(eq(connectionUserKey.ownerUserId, owner))
              .returning({ owner: connectionUserKey.ownerUserId });
            await tx.delete(receipt).where(eq(receipt.ownerUserId, owner));
            const credentials = await tx
              .delete(connectionCredential)
              .where(eq(connectionCredential.ownerUserId, owner))
              .returning({ id: connectionCredential.connectionId });
            const connections = await tx
              .delete(connection)
              .where(eq(connection.ownerUserId, owner))
              .returning({ id: connection.id });
            const result = {
              connections: connections.length,
              credentials: credentials.length,
              userKey: keyRows.length > 0,
            };
            if (result.connections || result.credentials || result.userKey)
              await record(tx, owner, "purged");
            return result;
          },
          { isolationLevel: "read committed" },
        );
      } catch (error) {
        if (error instanceof AccessError || error instanceof ConnectionStoreError) throw error;
        return fail("unavailable");
      }
    },
    async listOwned(actor: ActiveActor, input: unknown) {
      const owner = requireConnectionActor(actor);
      const parsed = parseList(input);
      const after = parsed.cursor ? keys.readCursor(owner, parsed.cursor) : undefined;
      try {
        return await db.transaction(
          async (tx) => {
            await member(tx, actor);
            const rows = await tx
              .select(selected)
              .from(connection)
              .where(
                and(
                  eq(connection.ownerUserId, owner),
                  after ? gt(connection.id, after) : undefined,
                ),
              )
              .orderBy(asc(connection.id))
              .limit(parsed.limit + 1);
            const items = rows.slice(0, parsed.limit).map(metadata);
            const last = items.at(-1);
            return Object.freeze({
              items: Object.freeze(items),
              nextCursor: rows.length > parsed.limit && last ? keys.cursor(owner, last.id) : null,
            });
          },
          { isolationLevel: "read committed" },
        );
      } catch (error) {
        if (error instanceof AccessError || error instanceof ConnectionStoreError) throw error;
        return fail("unavailable");
      }
    },
  });
}

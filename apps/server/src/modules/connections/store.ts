import { randomUUID } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, asc, eq, gt, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { connection, connectionCredential, connectionKeyCheck, connectionMutationReceipt as receipt, connectionNonce } from "@zetta/db/schema/connections";
import { membership } from "@zetta/db/schema/identity";
import { AccessError, requireOwned, type ActiveActor } from "../identity/access";
import { ConnectionStoreError, fail, metadata, uuid, requireConnectionActor, parseCreate, parseList, parseOptions, parseReplace, parseRevoke, type ConnectionMetadata, type Mutation } from "./store-contract";
import { createStoreKeys } from "./store-keys";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
function fields(table: typeof connection | typeof receipt) {
  return { kind: table.kind, provider: table.provider, label: table.label, state: table.state, revision: table.revision,
    createdAt: table.createdAt, updatedAt: table.updatedAt, expiresAt: table.expiresAt, revokedAt: table.revokedAt };
}
const selected = { id: connection.id, ...fields(connection), credentialVersion: connection.currentCredentialVersion };
const receiptSelected = { id: receipt.connectionId, ...fields(receipt), credentialVersion: receipt.credentialVersion };

async function member(tx: Transaction, actor: ActiveActor): Promise<void> {
  const [account] = await tx.select({ userId: user.id }).from(user).where(eq(user.id, actor.userId)).for("key share");
  if (account?.userId !== actor.userId) throw new AccessError("ACCESS_DENIED");
  const [row] = await tx.select({ status: membership.status })
    .from(membership).where(eq(membership.userId, actor.userId)).for("update");
  if (row?.status !== "active") throw new AccessError("ACCESS_DENIED");
}

export async function createConnectionStore(db: Pick<Database, "transaction">, options: unknown, nonceSource?: (size: number) => Uint8Array) {
  const { configuration, allowedProviders, initializeEmpty } = parseOptions(options);
  const keys = createStoreKeys(configuration, nonceSource);
  const keyId = configuration.keyId;
  async function keyCheck(tx: Transaction) {
    const [row] = await tx.select().from(connectionKeyCheck).where(eq(connectionKeyCheck.id, 1)).for("update");
    if (!row || row.encryptionCount < 1 || row.encryptionCount > 1000000) return fail("unavailable");
    const { envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext } = row;
    keys.verifyKeyCheck({ envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext });
    return row;
  }
  async function reserve(tx: Transaction, make: () => ReturnType<typeof keys.seal>, identity: { connectionId: string; credentialVersion: number } | null, now: Date) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const envelope = make();
      const [reserved] = await tx.insert(connectionNonce).values({ keyId, nonce: Buffer.from(envelope.nonce),
        purpose: identity ? "credential" : "key-check", connectionId: identity?.connectionId ?? null,
        credentialVersion: identity?.credentialVersion ?? null, createdAt: now })
        .onConflictDoNothing({ target: [connectionNonce.keyId, connectionNonce.nonce] }).returning({ keyId: connectionNonce.keyId });
      if (reserved) return { ...envelope, nonce: Buffer.from(envelope.nonce), tag: Buffer.from(envelope.tag), ciphertext: Buffer.from(envelope.ciphertext) };
    }
    return fail("unavailable");
  }
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(2053461108, 7002)`);
      const [existing] = await tx.select({ id: connectionKeyCheck.id }).from(connectionKeyCheck).limit(1);
      if (!existing) {
        if (!initializeEmpty) return fail("unavailable");
        for (const table of [connection, connectionCredential, connectionNonce, receipt, connectionKeyCheck]) {
          const [row] = await tx.select({ count: sql<string>`count(*)::text` }).from(table);
          if (row?.count !== "0") return fail("unavailable");
        }
        const envelope = await reserve(tx, keys.createKeyCheck, null, new Date());
        await tx.insert(connectionKeyCheck).values({ id: 1, ...envelope, noncePurpose: "key-check", encryptionCount: 1, createdAt: sql`clock_timestamp()` });
      }
      const check = await keyCheck(tx);
      const [counts] = await tx.select({ total: sql<string>`count(*)::text`, matching: sql<string>`count(*) filter (where ${connectionNonce.keyId} = ${keyId})::text` }).from(connectionNonce);
      if (!counts || Number(counts.total) !== check.encryptionCount || counts.total !== counts.matching) return fail("unavailable");
      const [nonce] = await tx.select({ purpose: connectionNonce.purpose }).from(connectionNonce)
        .where(and(eq(connectionNonce.keyId, keyId), eq(connectionNonce.nonce, check.nonce))).limit(1);
      if (nonce?.purpose !== "key-check") return fail("unavailable");
    }, { isolationLevel: "read committed" });
  } catch { return fail("unavailable"); }

  async function mutate(actor: ActiveActor, mutation: Mutation): Promise<ConnectionMetadata> {
    try {
      const owner = requireConnectionActor(actor);
      const requestMac = keys.requestMac(owner, mutation);
      return await db.transaction(async tx => {
        await member(tx, actor);
        const [prior] = await tx.select({ ...receiptSelected, requestMac: receipt.requestMac }).from(receipt)
          .where(and(eq(receipt.ownerUserId, owner), eq(receipt.operationId, mutation.input.operationId))).limit(1);
        if (prior) {
          if (!keys.sameMac(prior.requestMac, requestMac)) return fail("conflict");
          const { requestMac: _privateMac, ...safe } = prior;
          return metadata(safe);
        }
        let current: ConnectionMetadata | undefined;
        if (mutation.operation !== "create-api-key") {
          const [row] = await tx.select({ ...selected, ownerUserId: connection.ownerUserId }).from(connection)
            .where(and(eq(connection.id, mutation.input.id), eq(connection.ownerUserId, owner))).for("update");
          const { ownerUserId: _owner, ...safe } = requireOwned(actor, row);
          current = metadata(safe);
          if (current.revision !== mutation.input.expectedRevision || current.state !== "active") return fail("conflict");
          if (current.revision === 2147483647 || (mutation.operation === "replace-api-key" && current.credentialVersion === 2147483647)) return fail("conflict");
        }
        const check = await keyCheck(tx);
        const [clock] = await tx.select({ now: sql<string>`floor(extract(epoch from clock_timestamp()) * 1000)::text` }).from(connectionKeyCheck).where(eq(connectionKeyCheck.id, 1));
        const nowMs = Number(clock?.now);
        if (!Number.isSafeInteger(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) return fail("unavailable");
        const now = new Date(nowMs);
        let result: ConnectionMetadata;
        if (mutation.operation === "revoke") {
          if (!current) return fail("unavailable");
          const [row] = await tx.update(connection).set({ state: "revoked", revision: current.revision + 1, updatedAt: now, revokedAt: now })
            .where(and(eq(connection.id, current.id), eq(connection.ownerUserId, owner))).returning(selected);
          result = metadata(row);
        } else {
          const input = mutation.input;
          if (input.expiresAt !== null && input.expiresAt <= nowMs) return fail("invalid-input");
          if (mutation.operation === "create-api-key" && !allowedProviders.has(mutation.input.provider)) return fail("invalid-input");
          if (check.encryptionCount >= 1000000) return fail("key-capacity");
          const id = current?.id ?? randomUUID();
          const credentialVersion = (current?.credentialVersion ?? 0) + 1;
          const envelope = await reserve(tx, () => keys.seal(input.secret, { ownerUserId: owner, connectionId: id, kind: "api-key", credentialVersion }), { connectionId: id, credentialVersion }, now);
          const insertVersion = () => tx.insert(connectionCredential).values({ connectionId: id, credentialVersion, ownerUserId: owner, kind: "api-key", ...envelope, createdAt: now });
          if (mutation.operation === "create-api-key") {
            const [row] = await tx.insert(connection).values({ id, ownerUserId: owner, kind: "api-key", provider: mutation.input.provider, label: mutation.input.label,
              state: "active", revision: 1, currentCredentialVersion: 1, createdAt: now, updatedAt: now, revokedAt: null,
              expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt) }).returning(selected);
            result = metadata(row);
            await insertVersion();
          } else {
            if (!current) return fail("unavailable");
            await insertVersion();
            const [row] = await tx.update(connection).set({ revision: current.revision + 1, currentCredentialVersion: credentialVersion,
              updatedAt: now, expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt) })
              .where(and(eq(connection.id, id), eq(connection.ownerUserId, owner))).returning(selected);
            result = metadata(row);
          }
          await tx.update(connectionKeyCheck).set({ encryptionCount: check.encryptionCount + 1 }).where(eq(connectionKeyCheck.id, 1));
        }
        const { id: resultId, ...resultFields } = result;
        await tx.insert(receipt).values({ ...resultFields, connectionId: resultId, ownerUserId: owner, operationId: mutation.input.operationId,
          operation: mutation.operation, expectedRevision: mutation.operation === "create-api-key" ? null : mutation.input.expectedRevision, requestMac,
          createdAt: new Date(result.createdAt), updatedAt: new Date(result.updatedAt), expiresAt: result.expiresAt === null ? null : new Date(result.expiresAt),
          revokedAt: result.revokedAt === null ? null : new Date(result.revokedAt) });
        return result;
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof AccessError || error instanceof ConnectionStoreError) throw error;
      return fail("outcome-unknown");
    } finally {
      if (mutation.operation !== "revoke") mutation.input.secret.fill(0);
    }
  }
  return Object.freeze({
    createApiKey: (actor: ActiveActor, input: unknown) => mutate(actor, { operation: "create-api-key", input: parseCreate(input) }),
    replaceApiKey: (actor: ActiveActor, input: unknown) => mutate(actor, { operation: "replace-api-key", input: parseReplace(input) }),
    revoke: (actor: ActiveActor, input: unknown) => mutate(actor, { operation: "revoke", input: parseRevoke(input) }),
    /**
     * Server-side only: returns the decrypted secret for one active, unexpired connection of the actor, or fails closed.
     * The caller must zero the returned buffer after use. Revoked, expired, foreign or missing connections all fail the same way.
     */
    async resolveForExecution(actor: ActiveActor, id: string): Promise<Buffer> {
      const owner = requireConnectionActor(actor);
      if (!uuid.safeParse(id).success) return fail("not-found");
      try {
        return await db.transaction(async tx => {
          await member(tx, actor);
          const [row] = await tx.select({ ...selected, ownerUserId: connection.ownerUserId }).from(connection).where(and(eq(connection.id, id), eq(connection.ownerUserId, owner)));
          if (!row || row.state !== "active" || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return fail("not-found");
          const [cred] = await tx.select().from(connectionCredential).where(and(eq(connectionCredential.connectionId, id), eq(connectionCredential.credentialVersion, row.credentialVersion), eq(connectionCredential.ownerUserId, owner)));
          if (!cred) return fail("unavailable");
          const { envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext } = cred;
          return keys.open({ envelopeVersion, algorithm, keyId: storedKeyId, nonce, tag, ciphertext }, { ownerUserId: owner, connectionId: id, kind: "api-key", credentialVersion: row.credentialVersion });
        }, { isolationLevel: "read committed" });
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
        return await db.transaction(async tx => {
          await member(tx, actor);
          const rows = await tx.select(selected).from(connection).where(and(eq(connection.ownerUserId, owner), after ? gt(connection.id, after) : undefined))
            .orderBy(asc(connection.id)).limit(parsed.limit + 1);
          const items = rows.slice(0, parsed.limit).map(metadata);
          const last = items.at(-1);
          return Object.freeze({ items: Object.freeze(items), nextCursor: rows.length > parsed.limit && last ? keys.cursor(owner, last.id) : null });
        }, { isolationLevel: "read committed" });
      } catch (error) {
        if (error instanceof AccessError || error instanceof ConnectionStoreError) throw error;
        return fail("unavailable");
      }
    },
  });
}

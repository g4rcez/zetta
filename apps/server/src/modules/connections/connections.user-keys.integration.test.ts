import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createConnectionCrypto } from "./crypto";
import { createConnectionStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url?.endsWith("/zetta_test") ? describe : describe.skip; // initializes a key check: only ever against the dedicated test database
const ids = [
  `uk-a-${uuidv7()}`,
  `uk-b-${uuidv7()}`,
  `uk-legacy-${uuidv7()}`,
  `uk-cap-${uuidv7()}`,
  `uk-rot-${uuidv7()}`,
  `uk-purge-${uuidv7()}`,
  `uk-abort-${uuidv7()}`,
];
const [A, B, LEGACY, CAP, ROT, PURGE, ABORT] = ids as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const configuration = { key: Buffer.alloc(32, 7).toString("base64"), keyId: "v1" };

suite("per-user connection keys", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const actor = (id: string) => access.requireActive(new Headers({ "x-test-user": id }));
  const query = async <T>(text: string, params: unknown[] = []) =>
    (await db.$client.query(text, params)).rows as T[];
  const open = (initializeEmpty = false) =>
    createConnectionStore(db, { configuration, allowedProviders: ["anthropic"], initializeEmpty });
  const create = async (store: Awaited<ReturnType<typeof open>>, owner: string, secret: string) =>
    (
      await store.createApiKey(await actor(owner), {
        operationId: uuidv7(),
        provider: "anthropic",
        label: "key",
        secret: Buffer.from(secret),
        expiresAt: null,
      })
    ).id;

  beforeAll(async () => {
    const now = new Date();
    await db
      .insert(user)
      .values(
        ids.map((id) => ({
          id,
          name: id,
          email: `${id}@t.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })),
      );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids).catch(() => undefined);
  });

  test("a first credential creates the user key and is sealed under it", async () => {
    const store = await open(true);
    const id = await create(store, A, "sk-test-user-key-aaaa");
    expect(
      await query(
        "select key_version, nonce_purpose, encryption_count from connection_user_key where owner_user_id = $1",
        [A],
      ),
    ).toEqual([{ key_version: 1, nonce_purpose: "user-key", encryption_count: 1 }]);
    expect(
      await query("select key_id from connection_credential where connection_id = $1", [id]),
    ).toEqual([{ key_id: "u1" }]);
    expect((await store.resolveForExecution(await actor(A), id)).toString()).toBe(
      "sk-test-user-key-aaaa",
    );
  });

  test("each user has a different wrapped key", async () => {
    const store = await open();
    await create(store, A, "sk-test-user-key-a2");
    await create(store, B, "sk-test-user-key-bbbb");
    const [a, b] = await Promise.all(
      [A, B].map((owner) =>
        query<{ ciphertext: Buffer }>(
          "select ciphertext from connection_user_key where owner_user_id = $1",
          [owner],
        ),
      ),
    );
    expect(a![0]!.ciphertext.equals(b![0]!.ciphertext)).toBe(false);
  });

  test("a user key copied onto another user cannot open their credentials", async () => {
    const store = await open();
    const id = await create(store, B, "sk-test-user-key-b2");
    const [a] = await query<Record<string, unknown>>(
      "select envelope_version, algorithm, key_id, nonce, tag, ciphertext from connection_user_key where owner_user_id = $1",
      [A],
    );
    const [original] = await query<Record<string, unknown>>(
      "select envelope_version, algorithm, key_id, nonce, tag, ciphertext from connection_user_key where owner_user_id = $1",
      [B],
    );
    const set =
      "envelope_version = $2, algorithm = $3, key_id = $4, nonce = $5, tag = $6, ciphertext = $7";
    const values = (row: Record<string, unknown>) => [
      row.envelope_version,
      row.algorithm,
      row.key_id,
      row.nonce,
      row.tag,
      row.ciphertext,
    ];
    await query(`update connection_user_key set ${set} where owner_user_id = $1`, [
      B,
      ...values(a!),
    ]);
    try {
      await expect(store.resolveForExecution(await actor(B), id)).rejects.toMatchObject({
        code: "unavailable",
      });
    } finally {
      await query(`update connection_user_key set ${set} where owner_user_id = $1`, [
        B,
        ...values(original!),
      ]);
    }
    expect((await store.resolveForExecution(await actor(B), id)).toString()).toBe(
      "sk-test-user-key-b2",
    );
  });

  test("deleting one user's key makes only their credentials unrecoverable", async () => {
    const store = await open();
    const [idA, idB] = [
      await create(store, A, "sk-test-shred-a"),
      await create(store, B, "sk-test-shred-b"),
    ];
    const [saved] = await query<Record<string, unknown>>(
      "select * from connection_user_key where owner_user_id = $1",
      [A],
    );
    await query("delete from connection_user_key where owner_user_id = $1", [A]);
    try {
      await expect(store.resolveForExecution(await actor(A), idA)).rejects.toMatchObject({
        code: "unavailable",
      });
      expect((await store.resolveForExecution(await actor(B), idB)).toString()).toBe(
        "sk-test-shred-b",
      );
    } finally {
      const row = saved!;
      await query(
        "insert into connection_user_key (owner_user_id, key_version, envelope_version, algorithm, key_id, nonce, tag, ciphertext, nonce_purpose, encryption_count, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          row.owner_user_id,
          row.key_version,
          row.envelope_version,
          row.algorithm,
          row.key_id,
          row.nonce,
          row.tag,
          row.ciphertext,
          row.nonce_purpose,
          row.encryption_count,
          row.created_at,
        ],
      );
    }
  });

  test("boot moves a credential sealed under the deployment key under its owner's key, once", async () => {
    await open(true);
    const connectionId = uuidv7();
    const legacy = createConnectionCrypto(configuration).seal(
      Buffer.from("sk-test-legacy-secret"),
      { ownerUserId: LEGACY, connectionId, kind: "api-key", credentialVersion: 1 },
    );
    await query(
      "insert into connection (id, owner_user_id, kind, provider, label, state, revision, current_credential_version, created_at, updated_at) values ($1,$2,'api-key','anthropic','legacy','active',1,1,now(),now())",
      [connectionId, LEGACY],
    );
    await query(
      "insert into connection_nonce (key_id, nonce, purpose, connection_id, credential_version, created_at) values ('v1',$1,'credential',$2,1,now())",
      [legacy.nonce, connectionId],
    );
    await query(
      "insert into connection_credential (connection_id, credential_version, owner_user_id, kind, envelope_version, algorithm, key_id, nonce, tag, ciphertext, created_at) values ($1,1,$2,'api-key',1,'aes-256-gcm','v1',$3,$4,$5,now())",
      [connectionId, LEGACY, legacy.nonce, legacy.tag, legacy.ciphertext],
    );
    await query("update connection_key_check set encryption_count = encryption_count + 1");

    const store = await open();
    expect(
      await query("select key_id from connection_credential where connection_id = $1", [
        connectionId,
      ]),
    ).toEqual([{ key_id: "u1" }]);
    expect(
      await query(
        "select key_version, encryption_count from connection_user_key where owner_user_id = $1",
        [LEGACY],
      ),
    ).toEqual([{ key_version: 1, encryption_count: 1 }]);
    expect((await store.resolveForExecution(await actor(LEGACY), connectionId)).toString()).toBe(
      "sk-test-legacy-secret",
    );

    const [{ nonce: afterFirstBoot }] = (await query<{ nonce: Buffer }>(
      "select nonce from connection_credential where connection_id = $1",
      [connectionId],
    )) as [{ nonce: Buffer }];
    await open();
    const [{ nonce: afterSecondBoot }] = (await query<{ nonce: Buffer }>(
      "select nonce from connection_credential where connection_id = $1",
      [connectionId],
    )) as [{ nonce: Buffer }];
    expect(afterSecondBoot.equals(afterFirstBoot)).toBe(true);
  });

  test("a user key at its encryption limit refuses further credentials", async () => {
    const store = await open();
    await create(store, CAP, "sk-test-cap-first");
    await query(
      "update connection_user_key set encryption_count = 1000000 where owner_user_id = $1",
      [CAP],
    );
    await expect(create(store, CAP, "sk-test-cap-second")).rejects.toMatchObject({
      code: "key-capacity",
    });
  });

  test("the deployment key count grows by one per user key, not per credential", async () => {
    const store = await open();
    const [before] = await query<{ encryption_count: number }>(
      "select encryption_count from connection_key_check",
    );
    await create(store, A, "sk-test-count-1");
    await create(store, A, "sk-test-count-2");
    const [after] = await query<{ encryption_count: number }>(
      "select encryption_count from connection_key_check",
    );
    expect(after!.encryption_count).toBe(before!.encryption_count);
  });

  const audited = async (owner: string) =>
    (
      await query<{ detail: string }>(
        "select detail from audit_event where owner_user_id = $1 and kind = 'connection' order by created_at, id",
        [owner],
      )
    ).map((row) => row.detail);

  test("creating the first credential writes one key_created audit event", async () => {
    const store = await open();
    await create(store, ROT, "sk-test-audit-1");
    await create(store, ROT, "sk-test-audit-2");
    expect(await audited(ROT)).toEqual(["key_created"]);
  });

  test("rotating a user key moves every credential to the new key and keeps the secrets", async () => {
    const store = await open();
    const [first, second] = [
      await create(store, ROT, "sk-test-rotate-one"),
      await create(store, ROT, "sk-test-rotate-two"),
    ];
    const [other] = await query<{ ciphertext: Buffer }>(
      "select ciphertext from connection_user_key where owner_user_id = $1",
      [B],
    );
    const [kekBefore] = await query<{ encryption_count: number }>(
      "select encryption_count from connection_key_check",
    );

    expect(await store.rotateUserKey(ROT)).toEqual({ keyVersion: 2, credentials: 4 });

    expect(
      await query("select distinct key_id from connection_credential where owner_user_id = $1", [
        ROT,
      ]),
    ).toEqual([{ key_id: "u2" }]);
    expect(
      await query(
        "select key_version, encryption_count from connection_user_key where owner_user_id = $1",
        [ROT],
      ),
    ).toEqual([{ key_version: 2, encryption_count: 4 }]);
    expect((await store.resolveForExecution(await actor(ROT), first)).toString()).toBe(
      "sk-test-rotate-one",
    );
    expect((await store.resolveForExecution(await actor(ROT), second)).toString()).toBe(
      "sk-test-rotate-two",
    );
    const [otherAfter] = await query<{ ciphertext: Buffer }>(
      "select ciphertext from connection_user_key where owner_user_id = $1",
      [B],
    );
    expect(otherAfter!.ciphertext.equals(other!.ciphertext)).toBe(true);
    const [kekAfter] = await query<{ encryption_count: number }>(
      "select encryption_count from connection_key_check",
    );
    expect(kekAfter!.encryption_count).toBe(kekBefore!.encryption_count + 1);
    await open(); // the boot integrity check accepts the rotated ledger
  });

  test("a second rotation uses key version 3 and new credentials seal under it", async () => {
    const store = await open();
    expect(await store.rotateUserKey(ROT)).toEqual({ keyVersion: 3, credentials: 4 });
    const id = await create(store, ROT, "sk-test-after-rotation");
    expect(
      await query("select key_id from connection_credential where connection_id = $1", [id]),
    ).toEqual([{ key_id: "u3" }]);
    expect((await store.resolveForExecution(await actor(ROT), id)).toString()).toBe(
      "sk-test-after-rotation",
    );
  });

  test("rotation and the key creation are audited", async () => {
    expect(await audited(ROT)).toEqual(["key_created", "key_rotated", "key_rotated"]);
  });

  test("rotating a user who has no key is refused", async () => {
    const store = await open();
    await expect(store.rotateUserKey(PURGE)).rejects.toMatchObject({ code: "not-found" });
    await expect(store.rotateUserKey("")).rejects.toMatchObject({ code: "not-found" });
  });

  test("purging a user removes their connection data and nobody else's", async () => {
    const store = await open();
    const [mine, theirs] = [
      await create(store, PURGE, "sk-test-purge-mine"),
      await create(store, B, "sk-test-purge-theirs"),
    ];
    await create(store, PURGE, "sk-test-purge-mine-2");
    const rows = (owner: string) =>
      query<{ n: number }>(
        "select (select count(*) from connection where owner_user_id = $1)::int + (select count(*) from connection_credential where owner_user_id = $1)::int + (select count(*) from connection_user_key where owner_user_id = $1)::int + (select count(*) from connection_mutation_receipt where owner_user_id = $1)::int as n",
        [owner],
      );

    expect(await store.purgeOwner(PURGE)).toEqual({
      connections: 2,
      credentials: 2,
      userKey: true,
    });

    expect(await rows(PURGE)).toEqual([{ n: 0 }]);
    await expect(store.resolveForExecution(await actor(PURGE), mine)).rejects.toMatchObject({
      code: "not-found",
    });
    expect((await store.resolveForExecution(await actor(B), theirs)).toString()).toBe(
      "sk-test-purge-theirs",
    );
    expect(await audited(PURGE)).toEqual(["key_created", "purged"]);
    await open(); // the nonce ledger keeps its tombstones and still reconciles
  });

  test("purging the same user again changes nothing and writes no audit event", async () => {
    const store = await open();
    expect(await store.purgeOwner(PURGE)).toEqual({
      connections: 0,
      credentials: 0,
      userKey: false,
    });
    expect(await audited(PURGE)).toEqual(["key_created", "purged"]);
  });

  test("a credential that does not open aborts the whole rotation and changes nothing", async () => {
    const store = await open();
    const [good, bad] = [
      await create(store, ABORT, "sk-test-abort-good"),
      await create(store, ABORT, "sk-test-abort-bad"),
    ];
    const [before] = await query<{ ciphertext: Buffer }>(
      "select ciphertext from connection_user_key where owner_user_id = $1",
      [ABORT],
    );
    await query("update connection_credential set ciphertext = $2 where connection_id = $1", [
      bad,
      Buffer.alloc(18, 1),
    ]);

    await expect(store.rotateUserKey(ABORT)).rejects.toMatchObject({ code: "unavailable" });

    expect(
      await query("select distinct key_id from connection_credential where owner_user_id = $1", [
        ABORT,
      ]),
    ).toEqual([{ key_id: "u1" }]);
    const [after] = await query<{ key_version: number; ciphertext: Buffer }>(
      "select key_version, ciphertext from connection_user_key where owner_user_id = $1",
      [ABORT],
    );
    expect(after!.key_version).toBe(1);
    expect(after!.ciphertext.equals(before!.ciphertext)).toBe(true);
    expect((await store.resolveForExecution(await actor(ABORT), good)).toString()).toBe(
      "sk-test-abort-good",
    );
    expect(await audited(ABORT)).toEqual(["key_created"]);
  });
});

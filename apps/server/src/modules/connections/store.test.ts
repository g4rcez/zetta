import { expect, test } from "bun:test";
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { Database } from "@zetta/db";
import { createConnectionStore } from "./store";
import { createStoreKeys } from "./store-keys";
import { parseCreate, parseReplace, parseRevoke, type Mutation } from "./store-contract";
import { createIdentityAccess } from "../identity/access";

const operationId = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const key = randomBytes(32);
const configuration = { key: key.toString("base64"), keyId: "synthetic" };
const keys = createStoreKeys(configuration);
const create = () =>
  parseCreate({
    operationId,
    provider: "test",
    label: " e\u0301 ",
    secret: Buffer.from("\ufeff\0 secret "),
    expiresAt: 123456789,
  });
const oracleKey = Buffer.from(
  hkdfSync("sha256", key, Buffer.alloc(0), "zetta.connection.request-mac.v1", 32),
);
const oracle = (value: unknown[]) =>
  createHmac("sha256", oracleKey).update(JSON.stringify(value)).digest();

test("request MAC agrees with independent exact ADR arrays for all operations", () => {
  const created = create();
  expect(keys.requestMac("A", { operation: "create-api-key", input: created })).toEqual(
    oracle([
      "zetta.connection.request",
      1,
      "A",
      operationId,
      "create-api-key",
      "test",
      " e\u0301 ",
      Buffer.from("\ufeff\0 secret ").toString("base64"),
      123456789,
    ]),
  );
  const replaced = parseReplace({
    id,
    operationId,
    expectedRevision: 2,
    secret: Buffer.from("\0x"),
    expiresAt: null,
  });
  expect(keys.requestMac("A", { operation: "replace-api-key", input: replaced })).toEqual(
    oracle([
      "zetta.connection.request",
      1,
      "A",
      operationId,
      "replace-api-key",
      id,
      2,
      Buffer.from("\0x").toString("base64"),
      null,
    ]),
  );
  const revoked = parseRevoke({ id, operationId, expectedRevision: 3 });
  expect(keys.requestMac("A", { operation: "revoke", input: revoked })).toEqual(
    oracle(["zetta.connection.request", 1, "A", operationId, "revoke", id, 3]),
  );
});

test("every create input participates in request identity without normalization", () => {
  const original = create();
  const mac = keys.requestMac("A", { operation: "create-api-key", input: original });
  const changes = [
    { operationId: id },
    { provider: "other" },
    { label: " é " },
    { secret: Buffer.from("secret") },
    { expiresAt: null },
  ];
  for (const change of changes)
    expect(
      keys.sameMac(
        mac,
        keys.requestMac("A", { operation: "create-api-key", input: { ...original, ...change } }),
      ),
    ).toBe(false);
  expect(
    keys.sameMac(mac, keys.requestMac("B", { operation: "create-api-key", input: original })),
  ).toBe(false);
  expect(keys.sameMac(mac, mac)).toBe(true);
  expect(keys.sameMac(mac, Buffer.alloc(31))).toBe(false);
});

test("replace and revoke bind target, version, operation, secret and expiry", () => {
  const input = parseReplace({ id, operationId, expectedRevision: 1, secret: Buffer.from("x") });
  const original: Mutation = { operation: "replace-api-key", input };
  const mac = keys.requestMac("A", original);
  for (const change of [
    { id: operationId },
    { operationId: id },
    { expectedRevision: 2 },
    { secret: Buffer.from("y") },
    { expiresAt: 1 },
  ]) {
    expect(
      keys.sameMac(
        mac,
        keys.requestMac("A", { operation: "replace-api-key", input: { ...input, ...change } }),
      ),
    ).toBe(false);
  }
  const revoke = parseRevoke({ id, operationId, expectedRevision: 1 });
  const revokeMac = keys.requestMac("A", { operation: "revoke", input: revoke });
  expect(keys.sameMac(mac, revokeMac)).toBe(false);
  for (const change of [{ id: operationId }, { operationId: id }, { expectedRevision: 2 }])
    expect(
      keys.sameMac(
        revokeMac,
        keys.requestMac("A", { operation: "revoke", input: { ...revoke, ...change } }),
      ),
    ).toBe(false);
});

test("cursor is bounded, canonical, authenticated, owner-bound and domain-separated", () => {
  const cursor = keys.cursor("A", id);
  expect(keys.readCursor("A", cursor)).toBe(id);
  const [payload] = cursor.split(".");
  if (!payload) throw new Error("missing cursor payload");
  const forgedWithRequestKey = `${payload}.${createHmac("sha256", oracleKey).update(payload).digest("base64url")}`;
  for (const invalid of [
    cursor + "x",
    cursor.replace(/^./, "x"),
    forgedWithRequestKey,
    "x".repeat(2049),
    "e30.invalid",
    cursor + "=",
  ])
    expect(() => keys.readCursor("A", invalid)).toThrow();
  expect(() => keys.readCursor("B", cursor)).toThrow();
  const otherKeys = createStoreKeys({ ...configuration, key: randomBytes(32).toString("base64") });
  expect(() => otherKeys.readCursor("A", cursor)).toThrow();
  // `open` is internal to the store (used only by resolveForExecution); the public store object never exposes it.
  expect(keys).toHaveProperty("open");
  expect(keys).not.toHaveProperty("key");
  expect(JSON.stringify(keys)).toBe("{}");
});

test("invalid configuration cannot touch database; initialization failure is opaque", async () => {
  let calls = 0;
  const db: Pick<Database, "transaction"> = {
    transaction: async () => {
      calls++;
      throw new Error("private SQL secret");
    },
  };
  for (const options of [
    undefined,
    {},
    { configuration, allowedProviders: [], initializeEmpty: true, extra: true },
    { configuration, allowedProviders: ["https://bad"], initializeEmpty: true },
    { configuration, allowedProviders: [], initializeEmpty: "true" },
    {
      configuration: { ...configuration, key: "x".repeat(44) },
      allowedProviders: [],
      initializeEmpty: false,
    },
  ]) {
    await expect(createConnectionStore(db, options)).rejects.toThrow();
  }
  expect(calls).toBe(0);
  await expect(
    createConnectionStore(db, {
      configuration,
      allowedProviders: ["test"],
      initializeEmpty: false,
    }),
  ).rejects.toThrow("unavailable");
  expect(calls).toBe(1);
});

test("trusted nonce constructor seam reaches crypto while omitted default stays random", () => {
  const requested: number[] = [];
  const injected = createStoreKeys(configuration, (size) => {
    requested.push(size);
    return Buffer.alloc(size, 7);
  });
  expect([...injected.createKeyCheck().nonce]).toEqual(Array(12).fill(7));
  const context = { ownerUserId: "A", connectionId: id, kind: "api-key", credentialVersion: 1 };
  expect([...injected.seal(Buffer.from("synthetic"), context).nonce]).toEqual(Array(12).fill(7));
  expect(requested).toEqual([12, 12]);
  const defaultKeys = createStoreKeys(configuration);
  const first = defaultKeys.createKeyCheck();
  const second = defaultKeys.createKeyCheck();
  expect(first.nonce.byteLength).toBe(12);
  expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
  expect(() => defaultKeys.verifyKeyCheck(first)).not.toThrow();
});

test("nonce injection is rejected in JSON options and request fields", async () => {
  let databaseCalls = 0;
  const db: Pick<Database, "transaction"> = {
    transaction: async () => {
      databaseCalls++;
      throw new Error("forbidden database");
    },
  };
  const nonceSource = (size: number) => Buffer.alloc(size, 7);
  await expect(
    createConnectionStore(db, {
      configuration,
      allowedProviders: ["test"],
      initializeEmpty: false,
      nonceSource,
    }),
  ).rejects.toThrow("invalid-input");
  expect(() => parseCreate({ ...create(), nonceSource })).toThrow("invalid-input");
  expect(databaseCalls).toBe(0);
});

type Query = Readonly<{ text: string }>;
type Call = Readonly<{ text: string; params: readonly unknown[] }>;
const {
  drizzle,
}: {
  drizzle: (options: {
    client: { query: (query: Query, params?: unknown[]) => Promise<{ rows: unknown[][] }> };
  }) => Pick<Database, "transaction">;
} = createRequire(import.meta.resolve("@zetta/db"))("drizzle-orm/node-postgres");

async function guardFixture(account: boolean, membership: "active" | "removed" | null) {
  const sentinel = keys.createKeyCheck();
  const calls: Call[] = [];
  const db = drizzle({
    client: {
      async query({ text }, params = []) {
        calls.push({ text, params });
        let rows: unknown[][] = [];
        if (
          text.startsWith("begin") ||
          text === "commit" ||
          text === "rollback" ||
          text.includes("pg_advisory_xact_lock")
        )
          rows = [];
        else if (text.startsWith('select "id" from "zetta"."connection_key_check"')) rows = [[1]];
        else if (text.includes('from "zetta"."connection_key_check"'))
          rows = [
            [
              1,
              sentinel.envelopeVersion,
              sentinel.algorithm,
              sentinel.keyId,
              sentinel.nonce,
              sentinel.tag,
              sentinel.ciphertext,
              "key-check",
              1,
              "2030-01-01T00:00:00Z",
            ],
          ];
        else if (text.includes('from "zetta"."connection_nonce"'))
          rows = text.includes("count(*)") ? [["1", "0"]] : [["key-check"]];
        else if (text.includes('from "zetta"."connection_credential"')) rows = [];
        else if (text.includes('from "zetta"."user"')) rows = account ? [["owner"]] : [];
        else if (text.includes('from "zetta"."membership"'))
          rows = membership ? [[membership]] : [];
        else if (text.includes('from "zetta"."connection_mutation_receipt"'))
          throw new Error("synthetic stop after identity guard");
        else if (text.includes('from "zetta"."connection"')) rows = [];
        else throw new Error("Unexpected fixture query");
        return { rows };
      },
    },
  });
  const store = await createConnectionStore(db, {
    configuration,
    allowedProviders: ["test"],
    initializeEmpty: false,
  });
  const actor = await createIdentityAccess(
    { api: { getSession: async () => ({ user: { id: "owner" } }) } },
    async () => ({ isAdmin: false }),
  ).requireActive(new Headers());
  calls.length = 0;
  return {
    calls,
    operations: {
      list: () => store.listOwned(actor, {}),
      create: () =>
        store.createApiKey(actor, {
          operationId,
          provider: "test",
          label: "synthetic",
          secret: Buffer.from("synthetic"),
        }),
      replace: () =>
        store.replaceApiKey(actor, {
          operationId,
          id,
          expectedRevision: 1,
          secret: Buffer.from("synthetic"),
        }),
      revoke: () => store.revoke(actor, { operationId, id, expectedRevision: 1 }),
    },
  };
}

for (const operation of ["list", "create", "replace", "revoke"] as const) {
  test(`${operation} prelocks its account KEY SHARE before membership and resource access`, async () => {
    const f = await guardFixture(true, "active");
    if (operation === "list")
      expect(await f.operations[operation]()).toEqual({ items: [], nextCursor: null });
    else await expect(f.operations[operation]()).rejects.toMatchObject({ code: "outcome-unknown" });
    const locks = f.calls.filter((call) => / for (key share|update)$/.test(call.text));
    expect(
      locks.map((call) => [
        call.text.match(/from "zetta"\."(user|membership)"/)?.[1],
        call.text.endsWith(" for key share"),
        call.params,
      ]),
    ).toEqual([
      ["user", true, ["owner"]],
      ["membership", false, ["owner"]],
    ]);
    expect(f.calls.indexOf(locks[1] ?? { text: "", params: [] })).toBeLessThan(
      f.calls.findIndex((call) => call.text.includes('from "zetta"."connection')),
    );
  });
  for (const [account, member] of [
    [false, "active"],
    [true, "removed"],
    [true, null],
  ] as const) {
    test(`${operation} denies stale issued actor when account=${account} and membership=${member}`, async () => {
      const f = await guardFixture(account, member);
      await expect(f.operations[operation]()).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      expect(f.calls.some((call) => call.text.includes('from "zetta"."connection'))).toBe(false);
      expect(f.calls.some((call) => call.text.includes('from "zetta"."membership"'))).toBe(account);
      expect(f.calls.at(-1)?.text).toBe("rollback");
    });
  }
}

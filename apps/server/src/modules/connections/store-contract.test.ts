import { expect, spyOn, test } from "bun:test";
import { parseCreate, parseReplace, parseRevoke, parseList, metadata, requireConnectionActor, parseOptions } from "./store-contract";
import { createIdentityAccess } from "../identity/access";
const operationId = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const input = () => ({ operationId, provider: "test", label: " label ", secret: Buffer.from("\ufeff\0 secret ") });

test("invalid sibling fields and extras never allocate a secret copy", () => {
  const secret = Buffer.from("synthetic-private");
  const original = Buffer.from;
  const copies: Buffer[] = [];
  const spy = spyOn(Buffer, "from").mockImplementation((...args: Parameters<typeof Buffer.from>) => {
    const result = Reflect.apply(original, Buffer, args);
    if (!Buffer.isBuffer(result)) throw new Error("unexpected buffer result");
    if (args[0] === secret) copies.push(result);
    return result;
  });
  try {
    for (const change of [{ label: "" }, { operationId: "bad" }, { expiresAt: Infinity }, { extra: true }]) {
      expect(() => parseCreate({ operationId, provider: "test", label: "valid", secret, ...change })).toThrow();
    }
    for (const change of [{ id: "bad" }, { expectedRevision: 0 }, { expiresAt: Infinity }, { extra: true }]) {
      expect(() => parseReplace({ id, operationId, expectedRevision: 1, secret, ...change })).toThrow();
    }
    expect(copies.length).toBe(0);
    expect(secret.toString()).toBe("synthetic-private");
  } finally { spy.mockRestore(); copies.forEach(copy => copy.fill(0)); secret.fill(0); }
});

test("UTF-8 validation examines the owned copy and wipes it on failure", () => {
  const secret = Buffer.from("valid");
  const original = Buffer.from;
  let copy: Buffer | undefined;
  const spy = spyOn(Buffer, "from").mockImplementation((...args: Parameters<typeof Buffer.from>) => {
    const result = Reflect.apply(original, Buffer, args);
    if (!Buffer.isBuffer(result)) throw new Error("unexpected buffer result");
    if (args[0] === secret) { copy = result; result[0] = 255; }
    return result;
  });
  try {
    expect(() => parseCreate({ operationId, provider: "test", label: "valid", secret })).toThrow();
    expect(copy).toBeDefined();
    expect(copy?.every(byte => byte === 0)).toBe(true);
    expect(secret.toString()).toBe("valid");
  } finally { spy.mockRestore(); copy?.fill(0); secret.fill(0); }
});

test("shared input bytes become one private copy before returning", () => {
  const secret = new Uint8Array(new SharedArrayBuffer(5)); secret.set([65, 0, 239, 187, 191]);
  const original = Buffer.from; let count = 0;
  const spy = spyOn(Buffer, "from").mockImplementation((...args: Parameters<typeof Buffer.from>) => {
    const result = Reflect.apply(original, Buffer, args);
    if (!Buffer.isBuffer(result)) throw new Error("unexpected buffer result");
    if (args[0] === secret) count++;
    return result;
  });
  try {
    const parsed = parseReplace({ id, operationId, expectedRevision: 1, secret });
    secret.fill(255);
    expect([...parsed.secret]).toEqual([65, 0, 239, 187, 191]);
    expect(count).toBe(1);
    parsed.secret.fill(0);
  } finally { spy.mockRestore(); secret.fill(0); }
});

test("secret bytes are copied, NUL/BOM and label whitespace preserved", () => {
  const original = input(); const parsed = parseCreate(original);
  original.secret.fill(0);
  expect(parsed.secret).toEqual(Buffer.from("\ufeff\0 secret "));
  expect(parsed.label).toBe(" label ");
  expect(parsed.expiresAt).toBeNull();
});
test("strict input validation rejects invalid text, dates and ambiguous identity", () => {
  for (const change of [{ extra: true }, { label: "a\0b" }, { label: "\ud800" }, { label: "😀".repeat(101) }, { secret: Buffer.from([255]) }, { secret: Buffer.alloc(0) }, { secret: Buffer.alloc(16385) }, { expiresAt: Number.MAX_SAFE_INTEGER }, { expiresAt: 1.5 }, { operationId: operationId.toUpperCase().replace("0001", "ABCD") }]) {
    expect(() => parseCreate({ ...input(), ...change })).toThrow();
  }
  expect(parseCreate({ ...input(), label: "😀".repeat(100), secret: Buffer.alloc(16384, 65), expiresAt: 0 }).expiresAt).toBe(0);
});
test("replace and revoke reject privilege fields and invalid revisions", () => {
  expect(parseReplace({ id, operationId, expectedRevision: 1, secret: Buffer.from("x") }).expiresAt).toBeNull();
  expect(parseRevoke({ id, operationId, expectedRevision: 1 }).id).toBe(id);
  expect(() => parseRevoke({ id, operationId, expectedRevision: 1, ownerUserId: "B" })).toThrow();
  expect(() => parseReplace({ id, operationId, expectedRevision: 0, secret: Buffer.from("x") })).toThrow();
});
test("pagination is bounded and metadata never accepts hidden fields", () => {
  expect(parseList({})).toEqual({ limit: 50 });
  for (const limit of [0, 101, 1.5, Infinity]) expect(() => parseList({ limit })).toThrow();
  const row = { id, kind: "api-key", provider: "test", label: "safe", state: "active", revision: 1, credentialVersion: 1, createdAt: new Date(0), updatedAt: new Date(0), expiresAt: null, revokedAt: null };
  expect(metadata(row).createdAt).toBe(0);
  expect(Object.isFrozen(metadata(row))).toBe(true);
  expect(() => metadata({ ...row, ciphertext: Buffer.from("private") })).toThrow();
  expect(() => metadata({ ...row, createdAt: new Date(NaN) })).toThrow();
  expect(() => metadata({ ...row, state: "revoked" })).toThrow();
});

test("actor provenance rejects structural actors and admin cannot forge authority", async () => {
  for (const isAdmin of [false, true]) expect(() => requireConnectionActor({ userId: "A", isAdmin })).toThrow();
  const access = createIdentityAccess({ api: { getSession: async () => ({ user: { id: "A" } }) } }, async () => ({ isAdmin: false }));
  const actor = await access.requireActive(new Headers());
  expect(requireConnectionActor(actor)).toBe("A");
  expect(() => requireConnectionActor({ ...actor })).toThrow();
});

test("trusted provider allowlist is copied and invalid options fail", () => {
  const providers = ["test"];
  const configuration = { key: "x".repeat(44), keyId: "test" };
  const parsed = parseOptions({ configuration, allowedProviders: providers, initializeEmpty: false });
  providers.push("other"); configuration.keyId = "changed";
  expect([...parsed.allowedProviders]).toEqual(["test"]);
  expect(parsed.configuration.keyId).toBe("test");
  expect(() => parseOptions({ configuration, allowedProviders: providers })).toThrow();
});

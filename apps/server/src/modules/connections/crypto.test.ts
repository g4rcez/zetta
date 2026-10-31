import { expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { createConnectionCrypto, ConnectionCryptoError } from "./crypto";

const key = randomBytes(32);
const config = { key: key.toString("base64"), keyId: "test_1" };
const context = {
  ownerUserId: "owner-a",
  connectionId: "a8361acf-c814-4ab0-984a-f30515fececc",
  kind: "api-key",
  credentialVersion: 1,
};
const crypto = createConnectionCrypto(config);

for (const size of [1, 16384]) {
  test(`roundtrips ${size} exact UTF-8 bytes`, () => {
    // Given
    const secret = Buffer.alloc(size, 97);
    // When
    const opened = crypto.open(crypto.seal(secret, context), context);
    // Then
    expect(opened).toEqual(secret);
  });
}
for (const secret of [
  Buffer.alloc(0),
  Buffer.alloc(16385),
  Buffer.from([0xff]),
  Buffer.from([0xc0, 0xaf]),
]) {
  test(`rejects invalid plaintext ${secret.length}/${secret[0]}`, () => {
    // Given / When / Then
    expect(() => crypto.seal(secret, context)).toThrow(ConnectionCryptoError);
  });
}
test("preserves BOM and Unicode without normalization", () => {
  // Given
  const secret = Buffer.from("\ufeff e\u0301\n😀 ");
  // When / Then
  expect(crypto.open(crypto.seal(secret, context), context)).toEqual(secret);
});
test("generates distinct nonces for repeat encryption", () => {
  // Given
  const secret = Buffer.from("synthetic");
  // When
  const envelopes = [crypto.seal(secret, context), crypto.seal(secret, context)];
  // Then
  expect(envelopes[0]?.nonce).not.toEqual(envelopes[1]?.nonce);
});
for (const candidate of [
  undefined,
  {},
  { ...config, key: "" },
  { ...config, key: `${config.key}\n` },
  { ...config, key: randomBytes(31).toString("base64") },
  { ...config, key: randomBytes(33).toString("base64") },
  { ...config, key: "!".repeat(44) },
  { ...config, keyId: "A" },
  { ...config, keyId: "a".repeat(33) },
]) {
  test("rejects malformed configuration without secret-bearing errors", () => {
    // Given / When / Then
    expect(() => createConnectionCrypto(candidate)).toThrow("connection-crypto-configuration");
  });
}
for (const replacement of [
  { ownerUserId: "owner-b" },
  { connectionId: "b8361acf-c814-4ab0-984a-f30515fececc" },
  { kind: "native-profile" },
  { credentialVersion: 2 },
]) {
  test(`rejects substituted AAD ${Object.keys(replacement)[0]}`, () => {
    // Given
    const envelope = crypto.seal(Buffer.from("synthetic"), context);
    // When / Then
    expect(() => crypto.open(envelope, { ...context, ...replacement })).toThrow(
      ConnectionCryptoError,
    );
  });
}
for (const field of ["nonce", "tag", "ciphertext"] as const) {
  test(`rejects tampered ${field} without returning plaintext`, () => {
    // Given
    const envelope = crypto.seal(Buffer.from("synthetic"), context);
    const changed = Buffer.from(envelope[field]);
    changed[0] = (changed[0] ?? 0) ^ 1;
    let output: Uint8Array | undefined;
    // When / Then
    expect(() => {
      output = crypto.open({ ...envelope, [field]: changed }, context);
    }).toThrow("connection-crypto-unavailable");
    expect(output).toBeUndefined();
  });
}
for (const replacement of [
  { envelopeVersion: 2 },
  { algorithm: "aes-128-gcm" },
  { keyId: "other" },
  { nonce: Buffer.alloc(11) },
  { tag: Buffer.alloc(15) },
  { ciphertext: Buffer.alloc(0) },
  { ciphertext: Buffer.alloc(16385) },
  { extra: true },
  { tag: undefined },
]) {
  test("rejects unsupported, truncated or oversized envelopes", () => {
    // Given
    const envelope = crypto.seal(Buffer.from("synthetic"), context);
    // When / Then
    expect(() => crypto.open({ ...envelope, ...replacement }, context)).toThrow(
      ConnectionCryptoError,
    );
  });
}
test("rejects wrong key bytes even with matching ID", () => {
  // Given
  const other = createConnectionCrypto({ ...config, key: randomBytes(32).toString("base64") });
  const envelope = crypto.seal(Buffer.from("synthetic"), context);
  // When / Then
  expect(() => other.open(envelope, context)).toThrow("connection-crypto-unavailable");
});
test("uses the exact ADR AAD encoding and rejects authenticated invalid UTF-8", () => {
  // Given
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(
    Buffer.from(
      JSON.stringify([
        "zetta.connection",
        1,
        config.keyId,
        context.ownerUserId,
        context.connectionId,
        "api-key",
        1,
      ]),
    ),
  );
  const ciphertext = Buffer.concat([cipher.update(Buffer.from([0xff])), cipher.final()]);
  const envelope = {
    envelopeVersion: 1,
    algorithm: "aes-256-gcm",
    keyId: config.keyId,
    nonce,
    tag: cipher.getAuthTag(),
    ciphertext,
  };
  // When / Then
  expect(() => crypto.open(envelope, context)).toThrow("connection-crypto-unavailable");
});
test("verifies key-check but rejects wrong key and cross-domain use", () => {
  // Given
  const check = crypto.createKeyCheck();
  const other = createConnectionCrypto({ ...config, key: randomBytes(32).toString("base64") });
  // When / Then
  expect(() => crypto.verifyKeyCheck(check)).not.toThrow();
  expect(() => other.verifyKeyCheck(check)).toThrow(ConnectionCryptoError);
  expect(() => crypto.open(check, context)).toThrow(ConnectionCryptoError);
  expect(() => crypto.verifyKeyCheck(crypto.seal(Buffer.from("synthetic"), context))).toThrow(
    ConnectionCryptoError,
  );
});
test("sanitizes randomness failure", () => {
  // Given
  const failing = createConnectionCrypto(config, () => {
    throw new Error("private failure");
  });
  // When / Then
  expect(() => failing.seal(Buffer.from("synthetic"), context)).toThrow(
    "connection-crypto-unavailable",
  );
});
test("decrypts an independently encrypted ADR envelope", () => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(
    Buffer.from(
      JSON.stringify([
        "zetta.connection",
        1,
        config.keyId,
        context.ownerUserId,
        context.connectionId,
        "api-key",
        1,
      ]),
    ),
  );
  const ciphertext = Buffer.concat([cipher.update(Buffer.from("independent")), cipher.final()]);
  const envelope = {
    envelopeVersion: 1,
    algorithm: "aes-256-gcm",
    keyId: config.keyId,
    nonce,
    tag: cipher.getAuthTag(),
    ciphertext,
  };
  expect(crypto.open(envelope, context)).toEqual(Buffer.from("independent"));
});
test("rejects noncanonical base64 padding bits", () => {
  const canonical = Buffer.alloc(32).toString("base64");
  expect(() => createConnectionCrypto({ ...config, key: `${canonical.slice(0, 42)}B=` })).toThrow(
    ConnectionCryptoError,
  );
});
for (const replacement of [
  { ownerUserId: "" },
  { ownerUserId: "😀".repeat(65) },
  { ownerUserId: "\ud800" },
  { connectionId: "not-a-uuid" },
  { credentialVersion: 0 },
  { credentialVersion: 1.5 },
  { credentialVersion: 2147483648 },
  { extra: true },
]) {
  test("rejects malformed identity before encryption", () => {
    expect(() => crypto.seal(Buffer.from("synthetic"), { ...context, ...replacement })).toThrow(
      ConnectionCryptoError,
    );
  });
}
test("rejects wrong-size randomness", () => {
  const failing = createConnectionCrypto(config, () => Buffer.alloc(11));
  expect(() => failing.seal(Buffer.from("synthetic"), context)).toThrow(ConnectionCryptoError);
});
test("authenticates key ID even when the receiving service accepts the substituted ID", () => {
  const envelope = crypto.seal(Buffer.from("synthetic"), context);
  const other = createConnectionCrypto({ ...config, keyId: "other" });
  expect(() => other.open({ ...envelope, keyId: "other" }, context)).toThrow(
    "connection-crypto-unavailable",
  );
});
test("does not serialize the key in its service object or errors", () => {
  expect(JSON.stringify(crypto)).toBe("{}");
  const failure = new ConnectionCryptoError("connection-crypto-unavailable");
  expect(failure.cause).toBeUndefined();
  expect(JSON.stringify(failure)).not.toContain(config.key);
});

const userKey = Buffer.alloc(32, 7);
const wrapContext = { ownerUserId: "owner-a", keyVersion: 1 };
test("wraps and unwraps a user key under the deployment key", () => {
  const wrapped = crypto.wrapUserKey(userKey, wrapContext);
  expect(crypto.unwrapUserKey(wrapped, wrapContext)).toEqual(userKey);
});
test("a wrapped user key does not contain the key bytes", () => {
  const wrapped = crypto.wrapUserKey(userKey, wrapContext);
  expect(Buffer.from(wrapped.ciphertext).includes(userKey)).toBe(false);
});
test("rejects unwrapping a user key for another owner", () => {
  const wrapped = crypto.wrapUserKey(userKey, wrapContext);
  expect(() => crypto.unwrapUserKey(wrapped, { ownerUserId: "owner-b", keyVersion: 1 })).toThrow(
    "connection-crypto-unavailable",
  );
});
test("rejects unwrapping a user key for another key version", () => {
  const wrapped = crypto.wrapUserKey(userKey, wrapContext);
  expect(() => crypto.unwrapUserKey(wrapped, { ownerUserId: "owner-a", keyVersion: 2 })).toThrow(
    "connection-crypto-unavailable",
  );
});
test("rejects unwrapping with wrong deployment key bytes", () => {
  const other = createConnectionCrypto({ ...config, key: randomBytes(32).toString("base64") });
  expect(() => other.unwrapUserKey(crypto.wrapUserKey(userKey, wrapContext), wrapContext)).toThrow(
    "connection-crypto-unavailable",
  );
});
test("rejects a user key that is not 32 bytes", () => {
  expect(() => crypto.wrapUserKey(Buffer.alloc(31, 7), wrapContext)).toThrow(
    "connection-crypto-configuration",
  );
  expect(() => crypto.wrapUserKey(Buffer.alloc(33, 7), wrapContext)).toThrow(
    "connection-crypto-configuration",
  );
});
test("the deployment key cannot open a credential sealed by a user key", () => {
  const sealed = crypto.forUserKey(userKey, 1).seal(Buffer.from("synthetic"), context);
  expect(() => crypto.open(sealed, context)).toThrow("connection-crypto-unavailable");
});
test("a wrapped user key is not a credential", () => {
  const wrapped = crypto.wrapUserKey(userKey, wrapContext);
  expect(() => crypto.forUserKey(userKey, 1).open(wrapped, context)).toThrow(
    "connection-crypto-unavailable",
  );
});
test("seals and opens a credential under a user key with key id u1", () => {
  const sealed = crypto.forUserKey(userKey, 1).seal(Buffer.from("synthetic"), context);
  expect(sealed.keyId).toBe("u1");
  expect(crypto.forUserKey(userKey, 1).open(sealed, context)).toEqual(Buffer.from("synthetic"));
});
test("another user's key cannot open the credential", () => {
  const sealed = crypto.forUserKey(userKey, 1).seal(Buffer.from("synthetic"), context);
  expect(() => crypto.forUserKey(Buffer.alloc(32, 9), 1).open(sealed, context)).toThrow(
    "connection-crypto-unavailable",
  );
});
test("a user key rejects an envelope with another key id", () => {
  const sealed = crypto.forUserKey(userKey, 1).seal(Buffer.from("synthetic"), context);
  expect(() => crypto.forUserKey(userKey, 1).open({ ...sealed, keyId: "u2" }, context)).toThrow(
    "connection-crypto-unavailable",
  );
  expect(() =>
    crypto.forUserKey(userKey, 1).open({ ...sealed, keyId: config.keyId }, context),
  ).toThrow("connection-crypto-unavailable");
});
test("a user key still binds the credential to its owner", () => {
  const sealed = crypto.forUserKey(userKey, 1).seal(Buffer.from("synthetic"), context);
  expect(() =>
    crypto.forUserKey(userKey, 1).open(sealed, { ...context, ownerUserId: "owner-b" }),
  ).toThrow("connection-crypto-unavailable");
});
test("rejects a user key of the wrong size or version", () => {
  expect(() => crypto.forUserKey(Buffer.alloc(16, 7), 1)).toThrow(
    "connection-crypto-configuration",
  );
  expect(() => crypto.forUserKey(userKey, 0)).toThrow("connection-crypto-configuration");
  expect(() => crypto.forUserKey(userKey, 1.5)).toThrow("connection-crypto-configuration");
});
test("reserves u<n> key ids for user keys", () => {
  expect(() => createConnectionCrypto({ ...config, keyId: "u1" })).toThrow(
    "connection-crypto-configuration",
  );
  expect(() => createConnectionCrypto({ ...config, keyId: "u42" })).toThrow(
    "connection-crypto-configuration",
  );
  expect(() => createConnectionCrypto({ ...config, keyId: "user1" })).not.toThrow();
});

import { randomBytes } from "node:crypto";
import { createConnectionCrypto, ConnectionCryptoError } from "../apps/server/src/modules/connections/crypto";

function proof(): boolean {
  const configuration = { key: randomBytes(32).toString("base64"), keyId: "synthetic-proof" };
  const crypto = createConnectionCrypto(configuration);
  const context = { ownerUserId: "synthetic-owner", connectionId: "a8361acf-c814-4ab0-984a-f30515fececc", kind: "api-key", credentialVersion: 1 };
  const checks: Record<string, boolean> = {};
  const denied = (operation: () => unknown): boolean => {
    try {
      operation();
      return false;
    } catch (error) {
      return error instanceof ConnectionCryptoError && error.cause === undefined;
    }
  };
  for (const size of [1, 16384]) {
    const secret = Buffer.alloc(size, 97);
    checks[`roundtrip_${size}`] = crypto.open(crypto.seal(secret, context), context).equals(secret);
    secret.fill(0);
  }
  checks["empty_denied"] = denied(() => crypto.seal(Buffer.alloc(0), context));
  checks["oversize_denied"] = denied(() => crypto.seal(Buffer.alloc(16385), context));
  checks["invalid_utf8_denied"] = denied(() => crypto.seal(Buffer.from([0xff]), context));
  const envelope = crypto.seal(Buffer.from("synthetic-proof-only"), context);
  checks["fresh_nonce"] = !Buffer.from(envelope.nonce).equals(crypto.seal(Buffer.from("synthetic-proof-only"), context).nonce);
  checks["wrong_key_denied"] = denied(() => createConnectionCrypto({ ...configuration, key: randomBytes(32).toString("base64") }).open(envelope, context));
  checks["missing_key_denied"] = denied(() => createConnectionCrypto({ keyId: configuration.keyId }));
  checks["wrong_length_denied"] = denied(() => createConnectionCrypto({ ...configuration, key: randomBytes(31).toString("base64") }));
  checks["noncanonical_key_denied"] = denied(() => createConnectionCrypto({ ...configuration, key: `${configuration.key}\n` }));
  for (const [field, value] of Object.entries({ ownerUserId: "another-owner", connectionId: "b8361acf-c814-4ab0-984a-f30515fececc", kind: "native-profile", credentialVersion: 2 })) {
    checks[`aad_${field}_denied`] = denied(() => crypto.open(envelope, { ...context, [field]: value }));
  }
  checks["aad_keyId_denied"] = denied(() => crypto.open({ ...envelope, keyId: "another-key" }, context));
  for (const field of ["nonce", "tag", "ciphertext"] as const) {
    const changed = Buffer.from(envelope[field]);
    changed[0] = (changed[0] ?? 0) ^ 1;
    let released = false;
    checks[`${field}_tamper_denied`] = denied(() => {
      crypto.open({ ...envelope, [field]: changed }, context);
      released = true;
    });
    checks[`${field}_no_unauthenticated_output`] = !released;
  }
  checks["truncated_denied"] = denied(() => crypto.open({ ...envelope, tag: Buffer.alloc(15) }, context));
  checks["unknown_envelope_denied"] = denied(() => crypto.open({ ...envelope, envelopeVersion: 2 }, context));
  const check = crypto.createKeyCheck();
  crypto.verifyKeyCheck(check);
  checks["key_check_verified"] = true;
  checks["key_check_wrong_key_denied"] = denied(() => createConnectionCrypto({ ...configuration, key: randomBytes(32).toString("base64") }).verifyKeyCheck(check));
  checks["key_check_domain_denied"] = denied(() => crypto.open(check, context)) && denied(() => crypto.verifyKeyCheck(envelope));
  checks["randomness_failure_denied"] = denied(() => createConnectionCrypto(configuration, () => { throw new Error("synthetic"); }).seal(Buffer.from("synthetic"), context));
  console.log(JSON.stringify({ runtime: `Bun ${Bun.version}`, ...checks }));
  return Object.values(checks).every(Boolean);
}

if (import.meta.main) {
  try {
    process.exitCode = proof() ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ runtime: `Bun ${Bun.version}`, proof_completed: false }));
    process.exitCode = 1;
  }
  console.log(JSON.stringify({ exit: process.exitCode }));
}

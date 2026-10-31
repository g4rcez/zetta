import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const maxBytes = 16384;
const keyIdSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/);
// `u<n>` is reserved for per-user keys, so the deployment key id can never collide with a user key id.
const configSchema = z.strictObject({
  key: z.string().length(44),
  keyId: keyIdSchema.refine((value) => !/^u[0-9]+$/.test(value)),
});
const contextSchema = z.strictObject({
  ownerUserId: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => value.isWellFormed() && Buffer.byteLength(value) <= 256)
    .brand<"ConnectionOwnerId">(),
  connectionId: z
    .uuid()
    .refine((value) => value === value.toLowerCase())
    .brand<"ConnectionId">(),
  kind: z.literal("api-key"),
  credentialVersion: z.number().int().min(1).max(2147483647),
});
const wrapContextSchema = z.strictObject({
  ownerUserId: contextSchema.shape.ownerUserId,
  keyVersion: z.number().int().min(1).max(2147483647),
});
const userKeyBytes = 32;
const bytes = (min: number, max: number) =>
  z.instanceof(Uint8Array).refine((value) => value.byteLength >= min && value.byteLength <= max);
const envelopeSchema = z.strictObject({
  envelopeVersion: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  keyId: keyIdSchema,
  nonce: bytes(12, 12),
  tag: bytes(16, 16),
  ciphertext: bytes(1, maxBytes),
});
const sentinel = Buffer.from("zetta.connection-key-check.v1", "utf8");

export type ConnectionEnvelope = Readonly<z.infer<typeof envelopeSchema>>;
export class ConnectionCryptoError extends Error {
  constructor(readonly code: "connection-crypto-configuration" | "connection-crypto-unavailable") {
    super(code);
    this.name = "ConnectionCryptoError";
  }
}

function unavailable(): never {
  throw new ConnectionCryptoError("connection-crypto-unavailable");
}

function utf8(value: Uint8Array): void {
  if (value.byteLength < 1 || value.byteLength > maxBytes) unavailable();
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
}

export function createConnectionCrypto(
  configuration: unknown,
  nonceSource: (size: number) => Uint8Array = randomBytes,
) {
  const parsed = configSchema.safeParse(configuration);
  if (!parsed.success) throw new ConnectionCryptoError("connection-crypto-configuration");
  const key = Buffer.from(parsed.data.key, "base64");
  if (key.length !== 32 || key.toString("base64") !== parsed.data.key) {
    key.fill(0);
    throw new ConnectionCryptoError("connection-crypto-configuration");
  }
  const keyId = parsed.data.keyId;
  const keyCheckAad = Buffer.from(JSON.stringify(["zetta.connection-key-check", 1, keyId]));

  function aad(input: unknown, id: string = keyId): Buffer {
    const result = contextSchema.safeParse(input);
    if (!result.success) unavailable();
    const { ownerUserId, connectionId, kind, credentialVersion } = result.data;
    return Buffer.from(
      JSON.stringify([
        "zetta.connection",
        1,
        id,
        ownerUserId,
        connectionId,
        kind,
        credentialVersion,
      ]),
    );
  }

  function wrapAad(input: unknown): Buffer {
    const result = wrapContextSchema.safeParse(input);
    if (!result.success) unavailable();
    return Buffer.from(
      JSON.stringify(["zetta.user-key", 1, keyId, result.data.ownerUserId, result.data.keyVersion]),
    );
  }

  function encrypt(
    input: unknown,
    associatedData: Buffer,
    cipherKey: Buffer = key,
    id: string = keyId,
  ): ConnectionEnvelope {
    let plaintext: Buffer | undefined;
    try {
      if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > maxBytes)
        unavailable();
      plaintext = Buffer.from(input);
      utf8(plaintext);
      const nonce = Buffer.from(nonceSource(12));
      if (nonce.byteLength !== 12) unavailable();
      const cipher = createCipheriv("aes-256-gcm", cipherKey, nonce, { authTagLength: 16 });
      cipher.setAAD(associatedData);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        envelopeVersion: 1,
        algorithm: "aes-256-gcm",
        keyId: id,
        nonce,
        tag: cipher.getAuthTag(),
        ciphertext,
      };
    } catch {
      // Crypto exceptions can embed sensitive input; the service boundary exposes only a fixed code.
      return unavailable();
    } finally {
      plaintext?.fill(0);
    }
  }

  function decrypt(
    input: unknown,
    associatedData: Buffer,
    cipherKey: Buffer = key,
    id: string = keyId,
  ): Buffer {
    let pending: Buffer | undefined;
    let final: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      const parsedEnvelope = envelopeSchema.safeParse(input);
      if (!parsedEnvelope.success || parsedEnvelope.data.keyId !== id) unavailable();
      const envelope = parsedEnvelope.data;
      const decipher = createDecipheriv("aes-256-gcm", cipherKey, envelope.nonce, {
        authTagLength: 16,
      });
      decipher.setAAD(associatedData);
      decipher.setAuthTag(envelope.tag);
      pending = decipher.update(envelope.ciphertext);
      final = decipher.final();
      plaintext = Buffer.concat([pending, final]);
      utf8(plaintext);
      return Buffer.from(plaintext);
    } catch {
      // Never expose update() bytes or the raw crypto/decoder failure before authentication.
      return unavailable();
    } finally {
      pending?.fill(0);
      final?.fill(0);
      plaintext?.fill(0);
    }
  }

  function requireUserKey(dek: unknown, keyVersion: unknown): Buffer {
    if (
      !(dek instanceof Uint8Array) ||
      dek.byteLength !== userKeyBytes ||
      !wrapContextSchema.shape.keyVersion.safeParse(keyVersion).success
    ) {
      throw new ConnectionCryptoError("connection-crypto-configuration");
    }
    return Buffer.from(dek);
  }

  // The random key is stored as base64 text so it passes through the same UTF-8 checked path as every other secret.
  function wrapUserKey(dek: unknown, context: unknown) {
    const copy = requireUserKey(dek, (context as { keyVersion?: unknown } | null)?.keyVersion);
    const text = Buffer.from(copy.toString("base64"));
    try {
      return encrypt(text, wrapAad(context));
    } finally {
      copy.fill(0);
      text.fill(0);
    }
  }

  function unwrapUserKey(envelope: unknown, context: unknown): Buffer {
    const text = decrypt(envelope, wrapAad(context));
    try {
      const dek = Buffer.from(text.toString("utf8"), "base64");
      if (dek.length !== userKeyBytes || dek.toString("base64") !== text.toString("utf8")) {
        dek.fill(0);
        return unavailable();
      }
      return dek;
    } finally {
      text.fill(0);
    }
  }

  /** Seals and opens credentials under one user's key. Call `dispose` when done: it zeroes the in-memory key copy. */
  function forUserKey(dek: unknown, keyVersion: number) {
    const userKey = requireUserKey(dek, keyVersion);
    const id = `u${keyVersion}`;
    return Object.freeze({
      keyId: id,
      seal: (plaintext: unknown, context: unknown) =>
        encrypt(plaintext, aad(context, id), userKey, id),
      open: (envelope: unknown, context: unknown) =>
        decrypt(envelope, aad(context, id), userKey, id),
      dispose: () => void userKey.fill(0),
    });
  }

  return Object.freeze({
    wrapUserKey,
    unwrapUserKey,
    forUserKey,
    seal: (plaintext: unknown, context: unknown) => encrypt(plaintext, aad(context)),
    open: (envelope: unknown, context: unknown) => decrypt(envelope, aad(context)),
    createKeyCheck: () => encrypt(sentinel, keyCheckAad),
    verifyKeyCheck: (envelope: unknown): void => {
      const plaintext = decrypt(envelope, keyCheckAad);
      try {
        if (!plaintext.equals(sentinel)) unavailable();
      } finally {
        plaintext.fill(0);
      }
    },
  });
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const maxBytes = 16384;
const keyIdSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const configSchema = z.strictObject({ key: z.string().length(44), keyId: keyIdSchema });
const contextSchema = z.strictObject({
  ownerUserId: z.string().min(1).max(256).refine((value) => value.isWellFormed() && Buffer.byteLength(value) <= 256).brand<"ConnectionOwnerId">(),
  connectionId: z.uuid().refine((value) => value === value.toLowerCase()).brand<"ConnectionId">(),
  kind: z.literal("api-key"),
  credentialVersion: z.number().int().min(1).max(2147483647),
});
const bytes = (min: number, max: number) => z.instanceof(Uint8Array).refine((value) => value.byteLength >= min && value.byteLength <= max);
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

export function createConnectionCrypto(configuration: unknown, nonceSource: (size: number) => Uint8Array = randomBytes) {
  const parsed = configSchema.safeParse(configuration);
  if (!parsed.success) throw new ConnectionCryptoError("connection-crypto-configuration");
  const key = Buffer.from(parsed.data.key, "base64");
  if (key.length !== 32 || key.toString("base64") !== parsed.data.key) {
    key.fill(0);
    throw new ConnectionCryptoError("connection-crypto-configuration");
  }
  const keyId = parsed.data.keyId;
  const keyCheckAad = Buffer.from(JSON.stringify(["zetta.connection-key-check", 1, keyId]));

  function aad(input: unknown): Buffer {
    const result = contextSchema.safeParse(input);
    if (!result.success) unavailable();
    const { ownerUserId, connectionId, kind, credentialVersion } = result.data;
    return Buffer.from(JSON.stringify(["zetta.connection", 1, keyId, ownerUserId, connectionId, kind, credentialVersion]));
  }

  function encrypt(input: unknown, associatedData: Buffer): ConnectionEnvelope {
    let plaintext: Buffer | undefined;
    try {
      if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > maxBytes) unavailable();
      plaintext = Buffer.from(input);
      utf8(plaintext);
      const nonce = Buffer.from(nonceSource(12));
      if (nonce.byteLength !== 12) unavailable();
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(associatedData);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { envelopeVersion: 1, algorithm: "aes-256-gcm", keyId, nonce, tag: cipher.getAuthTag(), ciphertext };
    } catch {
      // Crypto exceptions can embed sensitive input; the service boundary exposes only a fixed code.
      return unavailable();
    } finally {
      plaintext?.fill(0);
    }
  }

  function decrypt(input: unknown, associatedData: Buffer): Buffer {
    let pending: Buffer | undefined;
    let final: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      const parsedEnvelope = envelopeSchema.safeParse(input);
      if (!parsedEnvelope.success || parsedEnvelope.data.keyId !== keyId) unavailable();
      const envelope = parsedEnvelope.data;
      const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce, { authTagLength: 16 });
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

  return Object.freeze({
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

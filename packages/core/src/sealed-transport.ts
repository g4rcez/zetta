/**
 * Application-layer encryption for credentials in transit, inside TLS: the browser seals a payload to the server's
 * public key, so a proxy, access log or crash report never holds the raw token.
 * ECDH P-256 (ephemeral client key) -> HKDF-SHA256 -> AES-256-GCM. The key and the AAD bind the key id, user, purpose and
 * issue time, so a sealed body cannot move to another user, route or time window.
 * Web Crypto only, so it runs in Bun and the browser. It does not stop an active MITM that swaps the public key: TLS does.
 */
/** Public half of a P-256 key in JWK form: the only key material that ever crosses the wire. */
export type TransportPublicKey = Readonly<{ kty: string; crv: string; x: string; y: string }>;
export type SealedPayload = Readonly<{
  v: 1;
  kid: string;
  epk: TransportPublicKey;
  iv: string;
  ct: string;
  iat: number;
}>;
export type TransportContext = Readonly<{ userId: string; purpose: string }>;

const maxPlaintext = 65536;
const maxCiphertextChars = Math.ceil(((maxPlaintext + 16) * 4) / 3);
const maxAgeMs = 5 * 60_000;
const maxSkewMs = 60_000;
const kidPattern = /^[a-z0-9_-]{1,32}$/;
const curve = { name: "ECDH", namedCurve: "P-256" } as const;

export class TransportError extends Error {
  constructor() {
    super("sealed-transport-invalid");
    this.name = "TransportError";
  }
}

const toB64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const fromB64 = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const info = (kid: string, context: TransportContext, iat: number) =>
  new Uint8Array(
    new TextEncoder().encode(
      JSON.stringify(["zetta.transport", 1, kid, context.userId, context.purpose, iat]),
    ),
  );

async function aesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  associatedData: Uint8Array<ArrayBuffer>,
) {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: associatedData },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const importPublic = (jwk: TransportPublicKey) =>
  crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    curve,
    false,
    [],
  );

/** Keeps only the public fields: an exported JWK of a private key would carry `d`. */
const publicJwk = (jwk: {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
}): TransportPublicKey => ({
  kty: jwk.kty ?? "",
  crv: jwk.crv ?? "",
  x: jwk.x ?? "",
  y: jwk.y ?? "",
});

/** The private key is non-extractable: it can be used in this process but never read out of it. */
export async function generateTransportKeyPair(): Promise<{
  publicKey: TransportPublicKey;
  privateKey: CryptoKey;
}> {
  const pair = await crypto.subtle.generateKey(curve, false, ["deriveBits"]);
  return {
    publicKey: publicJwk(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    privateKey: pair.privateKey,
  };
}

export async function seal(
  serverPublicKey: TransportPublicKey,
  kid: string,
  payload: unknown,
  context: TransportContext,
  now: number = Date.now(),
): Promise<SealedPayload> {
  try {
    if (!kidPattern.test(kid)) throw new TransportError();
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    if (plaintext.byteLength > maxPlaintext) throw new TransportError();
    const ephemeral = await crypto.subtle.generateKey(curve, false, ["deriveBits"]);
    const associatedData = info(kid, context, now);
    const key = await aesKey(
      ephemeral.privateKey,
      await importPublic(serverPublicKey),
      associatedData,
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: associatedData },
        key,
        plaintext,
      ),
    );
    const epk = await crypto.subtle.exportKey("jwk", ephemeral.publicKey);
    return { v: 1, kid, epk: publicJwk(epk), iv: toB64(iv), ct: toB64(ct), iat: now };
  } catch {
    throw new TransportError();
  }
}

function parse(input: unknown): SealedPayload {
  if (typeof input !== "object" || input === null) throw new TransportError();
  const { v, kid, epk, iv, ct, iat } = input as Record<string, unknown>;
  const key = epk as Record<string, unknown> | null;
  const valid =
    v === 1 &&
    typeof kid === "string" &&
    kidPattern.test(kid) &&
    typeof key === "object" &&
    key !== null &&
    key.kty === "EC" &&
    key.crv === "P-256" &&
    typeof key.x === "string" &&
    typeof key.y === "string" &&
    typeof iv === "string" &&
    iv.length === 16 &&
    typeof ct === "string" &&
    ct.length >= 22 &&
    ct.length <= maxCiphertextChars &&
    typeof iat === "number" &&
    Number.isSafeInteger(iat);
  if (!valid) throw new TransportError();
  return {
    v,
    kid,
    epk: { kty: "EC", crv: "P-256", x: key.x as string, y: key.y as string },
    iv,
    ct,
    iat,
  };
}

/** Validates every field before any crypto runs. Every failure is the same fixed error: no oracle for the caller. */
export async function open(
  privateKey: CryptoKey,
  input: unknown,
  context: TransportContext,
  now: number = Date.now(),
): Promise<unknown> {
  try {
    const sealed = parse(input);
    if (now - sealed.iat > maxAgeMs || sealed.iat - now > maxSkewMs) throw new TransportError();
    const associatedData = info(sealed.kid, context, sealed.iat);
    const key = await aesKey(privateKey, await importPublic(sealed.epk), associatedData);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(sealed.iv), additionalData: associatedData },
      key,
      fromB64(sealed.ct),
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    throw new TransportError();
  }
}

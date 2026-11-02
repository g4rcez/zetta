import { createHmac } from "node:crypto";

/**
 * RFC 6238 time-based one-time passwords, for vaults that hand back the seed (an `otpauth://` URI or a bare base32 secret) instead of the
 * current code. Supports the parameters authenticator apps use: SHA1/SHA256/SHA512, 6-8 digits, any period.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(raw: string): Buffer {
  const s = raw.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number, digits = 6, algorithm = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm, key).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** digits).padStart(digits, "0");
}

/** Current code for an `otpauth://totp/...?secret=...` URI or a bare base32 secret. */
export function totp(seed: string, now = Date.now()): string {
  let secret = seed.trim(),
    digits = 6,
    period = 30,
    algorithm = "sha1";
  if (/^otpauth:\/\//i.test(secret)) {
    const u = new URL(secret);
    if (u.hostname.toLowerCase() !== "totp") throw new Error("not a totp uri");
    secret = u.searchParams.get("secret") ?? "";
    digits = Number(u.searchParams.get("digits") ?? 6);
    period = Number(u.searchParams.get("period") ?? 30);
    algorithm = (u.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  }
  if (
    ![6, 7, 8].includes(digits) ||
    !(period >= 1 && period <= 300) ||
    !["sha1", "sha256", "sha512"].includes(algorithm)
  )
    throw new Error("unsupported totp parameters");
  const key = base32(secret);
  if (!key.length) throw new Error("empty secret");
  return hotp(key, Math.floor(now / 1000 / period), digits, algorithm);
}

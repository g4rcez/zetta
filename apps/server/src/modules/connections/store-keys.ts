import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createConnectionCrypto } from "./crypto";
import { fail, ownerId, uuid, type Mutation } from "./store-contract";

const cursorShape = z.tuple([z.literal(1), ownerId, uuid]);
export function createStoreKeys(
  configuration: { key: string; keyId: string },
  nonceSource?: (size: number) => Uint8Array,
) {
  const crypto = createConnectionCrypto(configuration, nonceSource);
  const raw = Buffer.from(configuration.key, "base64");
  let requestKey: Buffer;
  let cursorKey: Buffer;
  try {
    requestKey = Buffer.from(
      hkdfSync("sha256", raw, Buffer.alloc(0), "zetta.connection.request-mac.v1", 32),
    );
    cursorKey = Buffer.from(
      hkdfSync("sha256", raw, Buffer.alloc(0), "zetta.connection.cursor-mac.v1", 32),
    );
  } finally {
    raw.fill(0);
  }
  const mac = (key: Buffer, text: string) =>
    createHmac("sha256", key).update(text, "utf8").digest();
  function requestMac(owner: string, mutation: Mutation): Buffer {
    const { operation, input } = mutation;
    let fields: unknown[];
    if (operation === "create-api-key") {
      const value = mutation.input;
      fields = [
        "zetta.connection.request",
        1,
        owner,
        input.operationId,
        operation,
        value.provider,
        value.label,
        value.secret.toString("base64"),
        value.expiresAt,
      ];
    } else if (operation === "replace-api-key") {
      const value = mutation.input;
      fields = [
        "zetta.connection.request",
        1,
        owner,
        input.operationId,
        operation,
        value.id,
        value.expectedRevision,
        value.secret.toString("base64"),
        value.expiresAt,
      ];
    } else {
      const value = mutation.input;
      fields = [
        "zetta.connection.request",
        1,
        owner,
        input.operationId,
        operation,
        value.id,
        value.expectedRevision,
      ];
    }
    return mac(requestKey, JSON.stringify(fields));
  }
  function sameMac(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === 32 && right.byteLength === 32 && timingSafeEqual(left, right);
  }
  function cursor(owner: string, id: string): string {
    const fields = cursorShape.safeParse([1, owner, id]);
    if (!fields.success) return fail("unavailable");
    const payload = Buffer.from(JSON.stringify(fields.data)).toString("base64url");
    return `${payload}.${mac(cursorKey, payload).toString("base64url")}`;
  }
  function readCursor(owner: string, input: string): string {
    if (input.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input))
      return fail("invalid-input");
    const [payload, signature] = input.split(".");
    if (payload === undefined || signature === undefined) return fail("invalid-input");
    const signatureBytes = Buffer.from(signature, "base64url");
    if (
      signatureBytes.toString("base64url") !== signature ||
      !sameMac(signatureBytes, mac(cursorKey, payload))
    )
      return fail("invalid-input");
    try {
      const bytes = Buffer.from(payload, "base64url");
      if (bytes.toString("base64url") !== payload) return fail("invalid-input");
      const parsed = cursorShape.safeParse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      if (!parsed.success || parsed.data[1] !== owner || cursor(owner, parsed.data[2]) !== input)
        return fail("invalid-input");
      return parsed.data[2];
    } catch {
      return fail("invalid-input");
    }
  }
  // Decryption remains private: the metadata store can only verify its public key sentinel.
  return Object.freeze({
    seal: crypto.seal,
    open: crypto.open,
    wrapUserKey: crypto.wrapUserKey,
    unwrapUserKey: crypto.unwrapUserKey,
    forUserKey: crypto.forUserKey,
    createKeyCheck: crypto.createKeyCheck,
    verifyKeyCheck: crypto.verifyKeyCheck,
    requestMac,
    sameMac,
    cursor,
    readCursor,
  });
}

import { expect, test } from "bun:test";
import { generateTransportKeyPair, open, seal, TransportError } from "./sealed-transport";

const pair = await generateTransportKeyPair();
const other = await generateTransportKeyPair();
const context = { userId: "user-a", purpose: "plugin.install:telegram" };
const now = 1_800_000_000_000;

test("opens a sealed payload for the same user and purpose", async () => {
  const sealed = await seal(
    pair.publicKey,
    "k1",
    { config: { token: "sk-test-123" } },
    context,
    now,
  );
  expect(await open(pair.privateKey, sealed, context, now)).toEqual({
    config: { token: "sk-test-123" },
  });
});

test("the sealed body does not contain the secret", async () => {
  const sealed = await seal(
    pair.publicKey,
    "k1",
    { config: { token: "sk-test-123" } },
    context,
    now,
  );
  expect(JSON.stringify(sealed)).not.toContain("sk-test-123");
});

test("two seals of the same payload differ", async () => {
  const a = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  const b = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  expect(a.ct).not.toBe(b.ct);
});

test("rejects a payload opened for another user", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  await expect(
    open(pair.privateKey, sealed, { ...context, userId: "user-b" }, now),
  ).rejects.toBeInstanceOf(TransportError);
});

test("rejects a payload opened for another purpose", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  await expect(
    open(pair.privateKey, sealed, { ...context, purpose: "plugin.configure:telegram" }, now),
  ).rejects.toBeInstanceOf(TransportError);
});

test("rejects tampered ciphertext", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  const flipped = sealed.ct.startsWith("A") ? `B${sealed.ct.slice(1)}` : `A${sealed.ct.slice(1)}`;
  await expect(
    open(pair.privateKey, { ...sealed, ct: flipped }, context, now),
  ).rejects.toBeInstanceOf(TransportError);
});

test("rejects a tampered key id", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  await expect(
    open(pair.privateKey, { ...sealed, kid: "k2" }, context, now),
  ).rejects.toBeInstanceOf(TransportError);
});

test("rejects the wrong server private key", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  await expect(open(other.privateKey, sealed, context, now)).rejects.toBeInstanceOf(TransportError);
});

test("rejects a payload sealed 6 minutes ago", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  await expect(open(pair.privateKey, sealed, context, now + 6 * 60_000)).rejects.toBeInstanceOf(
    TransportError,
  );
});

test("rejects a payload sealed in the future by 2 minutes", async () => {
  const sealed = await seal(
    pair.publicKey,
    "k1",
    { secret: "sk-test-123" },
    context,
    now + 2 * 60_000,
  );
  await expect(open(pair.privateKey, sealed, context, now)).rejects.toBeInstanceOf(TransportError);
});

test("accepts a payload sealed 4 minutes ago", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  expect(await open(pair.privateKey, sealed, context, now + 4 * 60_000)).toEqual({
    secret: "sk-test-123",
  });
});

test("rejects malformed input with one fixed error", async () => {
  await expect(open(pair.privateKey, { v: 2 }, context, now)).rejects.toThrow(
    "sealed-transport-invalid",
  );
  await expect(open(pair.privateKey, "text", context, now)).rejects.toThrow(
    "sealed-transport-invalid",
  );
  await expect(open(pair.privateKey, null, context, now)).rejects.toThrow(
    "sealed-transport-invalid",
  );
});

test("rejects ciphertext above 64 KiB before decrypting", async () => {
  const sealed = await seal(pair.publicKey, "k1", { secret: "sk-test-123" }, context, now);
  await expect(
    open(pair.privateKey, { ...sealed, ct: "A".repeat(90_000) }, context, now),
  ).rejects.toThrow("sealed-transport-invalid");
});

test("refuses to seal a payload above 64 KiB", async () => {
  await expect(
    seal(pair.publicKey, "k1", { secret: "x".repeat(70_000) }, context, now),
  ).rejects.toBeInstanceOf(TransportError);
});

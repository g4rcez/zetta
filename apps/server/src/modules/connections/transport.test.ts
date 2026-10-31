import { expect, test } from "bun:test";
import { seal } from "@zetta/core/sealed-transport";
import { createTransportKeyring, TransportKeyExpiredError } from "./transport";

const context = { userId: "user-a", purpose: "connection.create:anthropic" };
const start = 1_800_000_000_000;
const hour = 3_600_000;
const minute = 60_000;

function fixture() {
  let now = start;
  return {
    keyring: createTransportKeyring(() => now),
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

test("opens a payload sealed to the published key", async () => {
  const { keyring, at } = fixture();
  const published = await keyring.publicKey();
  const sealed = await seal(
    published.publicKey,
    published.kid,
    { secret: "sk-test-12345678" },
    context,
    at(),
  );
  expect(await keyring.open(sealed, context)).toEqual({ secret: "sk-test-12345678" });
});

test("publishes a key that expires one hour after it was created", async () => {
  const { keyring } = fixture();
  expect((await keyring.publicKey()).expiresAt).toBe(start + hour);
});

test("keeps the same key until it is due for rotation", async () => {
  const { keyring, advance } = fixture();
  const first = await keyring.publicKey();
  advance(59 * minute);
  expect((await keyring.publicKey()).kid).toBe(first.kid);
});

test("rotates the key after one hour", async () => {
  const { keyring, advance } = fixture();
  const first = await keyring.publicKey();
  advance(hour);
  expect((await keyring.publicKey()).kid).not.toBe(first.kid);
});

test("still opens a payload sealed to the previous key within the 5 minute grace", async () => {
  const { keyring, advance, at } = fixture();
  const first = await keyring.publicKey();
  const sealed = await seal(
    first.publicKey,
    first.kid,
    { secret: "sk-test-12345678" },
    context,
    at() + hour - minute,
  );
  advance(hour);
  await keyring.publicKey();
  advance(4 * minute);
  expect(await keyring.open(sealed, context)).toEqual({ secret: "sk-test-12345678" });
});

test("refuses a payload sealed to the previous key after the grace", async () => {
  const { keyring, advance, at } = fixture();
  const first = await keyring.publicKey();
  const sealed = await seal(
    first.publicKey,
    first.kid,
    { secret: "sk-test-12345678" },
    context,
    at() + hour - 30_000,
  );
  advance(hour);
  await keyring.publicKey();
  advance(5 * minute + 1);
  await expect(keyring.open(sealed, context)).rejects.toBeInstanceOf(TransportKeyExpiredError);
});

test("refuses a key id it never published", async () => {
  const { keyring, at } = fixture();
  const published = await keyring.publicKey();
  const sealed = await seal(
    published.publicKey,
    "k-unknown",
    { secret: "sk-test-12345678" },
    context,
    at(),
  );
  await expect(keyring.open(sealed, context)).rejects.toBeInstanceOf(TransportKeyExpiredError);
});

test("two keyrings never share a key", async () => {
  const [a, b] = [fixture().keyring, fixture().keyring];
  expect((await a.publicKey()).kid).not.toBe((await b.publicKey()).kid);
});

test("concurrent first requests publish one key", async () => {
  const { keyring } = fixture();
  const [x, y] = await Promise.all([keyring.publicKey(), keyring.publicKey()]);
  expect(x.kid).toBe(y.kid);
});

test("a key that expired long before the next request gets no fresh grace", async () => {
  const { keyring, advance, at } = fixture();
  const first = await keyring.publicKey();
  const sealed = await seal(
    first.publicKey,
    first.kid,
    { secret: "sk-test-12345678" },
    context,
    at() + hour - 30_000,
  );
  advance(3 * hour);
  await expect(keyring.open(sealed, context)).rejects.toBeInstanceOf(TransportKeyExpiredError);
});

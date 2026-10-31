/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";

import { createSealedSend } from "./sealed-send";

const pair = await generateTransportKeyPair();
const published = (kid: string) => ({
  kid,
  publicKey: pair.publicKey,
  userId: "user-a",
  serverTime: 1_800_000_000_000,
});
const expired = Object.assign(new Error("rotated"), { code: "TRANSPORT_KEY_EXPIRED" });

describe("sealed credential send", () => {
  test("sends the payload sealed to the server key, never in plaintext", async () => {
    const sealedSend = createSealedSend(async () => published("k1"));
    let body = "";
    await sealedSend(
      "plugin.install:telegram",
      { config: { token: "tg-test-123456" } },
      async (sealed) => {
        body = JSON.stringify({ id: "telegram", sealed });
      },
    );
    expect(body).not.toContain("tg-test-123456");
    const sealed = JSON.parse(body).sealed;
    expect(
      await open(
        pair.privateKey,
        sealed,
        { userId: "user-a", purpose: "plugin.install:telegram" },
        1_800_000_000_000,
      ),
    ).toEqual({ config: { token: "tg-test-123456" } });
  });

  test("returns what the request returns", async () => {
    const sealedSend = createSealedSend(async () => published("k1"));
    expect(
      await sealedSend("connection.create:anthropic", { secret: "sk-test-12345678" }, async () => ({
        connection: { id: "c1" },
      })),
    ).toEqual({ connection: { id: "c1" } });
  });

  test("fetches a fresh key and retries once when the key rotated", async () => {
    const kids: string[] = [];
    const sealedSend = createSealedSend(async () => published(`k${kids.length + 1}`));
    const result = await sealedSend(
      "connection.create:anthropic",
      { secret: "sk-test-12345678" },
      async (sealed) => {
        kids.push(sealed.kid);
        if (kids.length === 1) throw expired;
        return "saved";
      },
    );
    expect([result, kids]).toEqual(["saved", ["k1", "k2"]]);
  });

  test("gives up after one retry", async () => {
    let sends = 0;
    const sealedSend = createSealedSend(async () => published("k1"));
    await expect(
      sealedSend("connection.create:anthropic", { secret: "sk-test-12345678" }, async () => {
        sends++;
        throw expired;
      }),
    ).rejects.toBe(expired);
    expect(sends).toBe(2);
  });

  test("does not retry other errors", async () => {
    let sends = 0;
    const failure = Object.assign(new Error("bad"), { code: "INVALID_REQUEST" });
    const sealedSend = createSealedSend(async () => published("k1"));
    await expect(
      sealedSend("connection.create:anthropic", { secret: "sk-test-12345678" }, async () => {
        sends++;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(sends).toBe(1);
  });

  test("refuses to send in plaintext when the page cannot encrypt", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    let sends = 0;
    try {
      const sealedSend = createSealedSend(async () => published("k1"));
      await expect(
        sealedSend("connection.create:anthropic", { secret: "sk-test-12345678" }, async () => {
          sends++;
        }),
      ).rejects.toThrow("cannot encrypt credentials");
    } finally {
      Object.defineProperty(globalThis, "crypto", original);
    }
    expect(sends).toBe(0);
  });
});

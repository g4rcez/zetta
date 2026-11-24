import { expect, test } from "bun:test";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";

import { setupDom } from "../skills/dom-env";

setupDom();
const pair = await generateTransportKeyPair();
const sent: { path: string; method: string; raw: string }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname === "/api/connections/transport-key")
    return Response.json({
      kid: "k1",
      publicKey: pair.publicKey,
      userId: "me",
      serverTime: Date.now(),
    });
  sent.push({ path: url.pathname, method: init?.method ?? "GET", raw: String(init?.body ?? "") });
  if (url.pathname === "/api/installation") return Response.json({ phoneTwilioKey: "set" });
  return Response.json({ ok: true });
}) as typeof fetch;

test("each provider's key travels sealed to its own route, never as plain text", async () => {
  const { installationApi } = await import("../onboarding/installation-api");
  sent.length = 0;
  await installationApi.savePhoneTwilioKey("twilio-token-fake-123");
  await installationApi.savePhoneKey("telnyx-key-fake-456");
  const twilio = sent.find((s) => s.path === "/api/connections/phone-twilio-key")!;
  const telnyx = sent.find((s) => s.path === "/api/connections/phone-key")!;
  expect(twilio.method).toBe("PUT");
  expect(telnyx.method).toBe("PUT");
  for (const s of sent) {
    expect(s.raw).not.toContain("twilio-token-fake-123");
    expect(s.raw).not.toContain("telnyx-key-fake-456");
  }
  expect(
    await open(
      pair.privateKey,
      JSON.parse(twilio.raw).sealed,
      { userId: "me", purpose: "installation.phone-twilio-key" },
      Date.now(),
    ),
  ).toEqual({ secret: "twilio-token-fake-123" });
  expect(
    await open(
      pair.privateKey,
      JSON.parse(telnyx.raw).sealed,
      { userId: "me", purpose: "installation.phone-key" },
      Date.now(),
    ),
  ).toEqual({ secret: "telnyx-key-fake-456" });
});

test("removing the Auth Token and testing a provider call the routes the server has", async () => {
  const { installationApi } = await import("../onboarding/installation-api");
  sent.length = 0;
  await installationApi.removePhoneTwilioKey();
  await installationApi.testPhone("twilio");
  await installationApi.testPhone();
  expect(
    sent.filter((s) => s.path !== "/api/installation").map((s) => [s.method, s.path, s.raw]),
  ).toEqual([
    ["DELETE", "/api/connections/phone-twilio-key", ""],
    ["POST", "/api/installation/phone/test", JSON.stringify({ provider: "twilio" })],
    ["POST", "/api/installation/phone/test", JSON.stringify({ provider: "telnyx" })],
  ]);
});

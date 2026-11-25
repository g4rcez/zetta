// Telnyx is a plugin: it is in the plugin registry with its own settings, and the phone module takes the account of a number's owner from
// that configuration (their own, else the team's) before the installation's old Telnyx settings. No network and no database.
import { afterAll, describe, expect, test } from "bun:test";
import { getPlugin } from "../integrations/plugins/registry";
import { fakeInstallationSettings } from "../installation/testing";
import { createPhoneProviderReader } from "./config";
import { startFakeTelnyx } from "./fake";
import { TELNYX_PLUGIN_ID, telnyxAccountOf, telnyxPlugin } from "./telnyx-plugin";

const fake = startFakeTelnyx();
const other = startFakeTelnyx();
afterAll(() => {
  fake.stop();
  other.stop();
});

describe("Telnyx is a plugin", () => {
  test("it is registered, native, with the API key sealed and its own settings", () => {
    const def = getPlugin(TELNYX_PLUGIN_ID);
    expect(def).toBe(telnyxPlugin);
    expect(def?.kind).toBe("native");
    expect(def?.auth).toBe("api-key");
    expect(def?.fields.map((f) => f.key)).toEqual(["apiKey", "publicKey", "applicationId"]);
    expect(def?.fields.find((f) => f.key === "apiKey")?.secret).toBe(true);
    // Not a built-in: it needs the person's own account, so nothing is on until they save it.
    expect(def?.builtin).toBeFalsy();
  });

  test("an account needs all three settings and a public key that can be read", () => {
    const full = { apiKey: "key-test", publicKey: fake.publicKey, applicationId: "app-1" };
    expect(telnyxAccountOf(full)).toEqual(full);
    for (const missing of ["apiKey", "publicKey", "applicationId"] as const)
      expect(telnyxAccountOf({ ...full, [missing]: " " })).toBeUndefined();
    expect(telnyxAccountOf({ ...full, publicKey: "AAAA" })).toBeUndefined();
  });
});

describe("the phone module uses the owner's Telnyx plugin account", () => {
  const settings = fakeInstallationSettings({
    phoneProvider: "off",
    phonePublicUrl: "https://zetta.example.invalid",
    phoneCountries: "US",
    phoneRequestMode: "owner_request",
  });
  const accounts: Record<string, { apiKey: string; publicKey: string; applicationId: string }> = {
    ana: { apiKey: "key-ana", publicKey: fake.publicKey, applicationId: "app-ana" },
    bia: { apiKey: "key-bia", publicKey: other.publicKey, applicationId: "app-bia" },
  };
  const reader = createPhoneProviderReader({
    load: async () => settings,
    key: { state: async () => "none", secret: async () => undefined },
    telnyxAccount: async (userId) => accounts[userId],
  });

  test("with an account Telnyx is offered and built; without one nothing is", async () => {
    expect((await reader.offer("ana")).providers?.map((p) => p.id)).toEqual(["telnyx"]);
    expect((await reader.offer("nobody")).providers).toEqual([]);
    expect((await reader.offer()).on).toBe(false);
    expect((await reader.provider("telnyx", "ana"))?.name).toBe("telnyx");
    expect(await reader.provider("telnyx", "nobody")).toBeUndefined();
    expect(await reader.provider("telnyx")).toBeUndefined();
  });

  test("each person gets their own provider, the same one while the account is the same", async () => {
    const a1 = await reader.provider("telnyx", "ana");
    expect(await reader.provider("telnyx", "ana")).toBe(a1);
    expect(await reader.provider("telnyx", "bia")).not.toBe(a1);
  });

  test("a webhook is checked with the key of the account at its address, not another person's", async () => {
    const signed = fake.webhook("call.hangup", { call_control_id: "v3:x" });
    const ana = await reader.provider("telnyx", "ana");
    const bia = await reader.provider("telnyx", "bia");
    expect(() => bia!.verifyWebhook(signed.body, signed.headers)).toThrow();
    expect(ana!.verifyWebhook(signed.body, signed.headers).type).toBe("call.hangup");
  });

  test("a number's provider for its owner is found from the row", async () => {
    expect((await reader.providerFor({ provider: "telnyx", ownerUserId: "ana" }))?.name).toBe(
      "telnyx",
    );
    expect(await reader.providerFor({ provider: "telnyx", ownerUserId: "nobody" })).toBeUndefined();
  });
});

// Twilio is a plugin: it is in the plugin registry with its own settings, and the phone module takes the account of a number's owner from
// that configuration (their own, else the team's) before the installation's old Twilio settings. No network and no database.
import { afterAll, describe, expect, test } from "bun:test";
import { fakeInstallationSettings } from "../installation/testing";
import { getPlugin } from "../integrations/plugins/registry";
import { createPhoneProviderReader } from "./config";
import { startFakeTwilio } from "./fake-twilio";
import { TWILIO_STATUS_PATH, TWILIO_VOICE_PATH, createTwilioProvider } from "./twilio";
import { TWILIO_PLUGIN_ID, twilioAccountOf, twilioPlugin, twilioRefusal } from "./twilio-plugin";

const fake = startFakeTwilio();
afterAll(() => fake.stop());

const SID = `AC${"a".repeat(32)}`;
const voiceParams = (callSid: string) => ({
  CallSid: callSid,
  AccountSid: fake.accountSid,
  From: "+12025550111",
  To: "+12025550122",
  CallStatus: "ringing",
  Direction: "inbound",
});
/** A voice webhook signed for the address of one person's account. */
const signedFor = (owner: string, token = fake.authToken) =>
  fake.webhook(`${TWILIO_VOICE_PATH}/${owner}`, voiceParams(`CA${"1".repeat(32)}`), {
    token,
    url: `${fake.publicUrl}${TWILIO_VOICE_PATH}/${owner}`,
  });

describe("Twilio is a plugin", () => {
  test("it is registered, native, with the Auth Token sealed and its own settings", () => {
    const def = getPlugin(TWILIO_PLUGIN_ID);
    expect(def).toBe(twilioPlugin);
    expect(def?.kind).toBe("native");
    expect(def?.auth).toBe("api-key");
    expect(def?.fields.map((f) => f.key)).toEqual(["accountSid", "authToken"]);
    expect(def?.fields.find((f) => f.key === "authToken")?.secret).toBe(true);
    expect(def?.fields.find((f) => f.key === "accountSid")?.secret).toBeFalsy();
    // Not a built-in: it needs the person's own account, so nothing is on until they save it.
    expect(def?.builtin).toBeFalsy();
  });

  test("an account needs a real Account SID and a token", () => {
    expect(twilioAccountOf({ accountSid: SID, authToken: "tok" })).toEqual({
      accountSid: SID,
      authToken: "tok",
    });
    expect(twilioAccountOf({ accountSid: SID, authToken: " " })).toBeUndefined();
    expect(twilioAccountOf({ accountSid: "AC123", authToken: "tok" })).toBeUndefined();
    expect(
      twilioAccountOf({ accountSid: `SK${"a".repeat(32)}`, authToken: "tok" }),
    ).toBeUndefined();
    expect(twilioAccountOf({ authToken: "tok" })).toBeUndefined();
  });

  test("the status tells a saved value that is not an Account SID from a missing one", async () => {
    const check = (config: Record<string, string>) =>
      twilioPlugin.status!({ userId: "ana", config, setConfig: async () => {} });
    expect(await check({ accountSid: "ana@example.invalid", authToken: "tok" })).toEqual({
      state: "needs-auth",
      detail: expect.stringContaining("The saved Account SID is not valid"),
    });
    expect(await check({})).toEqual({
      state: "needs-auth",
      detail: "Add the Account SID and the Auth Token.",
    });
  });

  test("a refusal says what Twilio answered and what to fix", () => {
    const base = { keyOk: false, applicationOk: false };
    expect(twilioRefusal({ ...base, refusal: { status: 401, code: 20003 } })).toContain(
      "(HTTP 401, error 20003)",
    );
    expect(twilioRefusal({ ...base, refusal: { status: 403, code: 20008 } })).toContain(
      "test credentials",
    );
    expect(twilioRefusal({ ...base, accountState: "closed" })).toContain("account is closed");
  });

  test("saving refuses what is not an Account SID, with the field's own rule", () => {
    const field = twilioPlugin.fields.find((f) => f.key === "accountSid")!;
    const rule = new RegExp(`^(?:${field.pattern!.source})$`);
    expect(rule.test(SID)).toBe(true);
    expect(rule.test(`SK${"a".repeat(32)}`)).toBe(false);
    expect(rule.test(`${SID} extra`)).toBe(false);
  });
});

describe("the phone module uses the owner's Twilio plugin account", () => {
  const settings = fakeInstallationSettings({
    phoneProvider: "off",
    phoneTwilio: "off",
    phonePublicUrl: fake.publicUrl,
    phoneCountries: "US",
    phoneRequestMode: "owner_request",
  });
  const accounts: Record<string, { accountSid: string; authToken: string }> = {
    ana: { accountSid: fake.accountSid, authToken: fake.authToken },
    bia: { accountSid: fake.accountSid, authToken: "bia-token" },
  };
  const reader = createPhoneProviderReader({
    load: async () => settings,
    key: { state: async () => "none", secret: async () => undefined },
    twilioAccount: async (userId) => accounts[userId],
  });

  test("with an account Twilio is offered and built; without one nothing is", async () => {
    expect((await reader.offer("ana")).providers?.map((p) => p.id)).toEqual(["twilio"]);
    expect((await reader.offer("nobody")).providers).toEqual([]);
    expect((await reader.offer()).on).toBe(false);
    expect((await reader.provider("twilio", "ana"))?.name).toBe("twilio");
    expect(await reader.provider("twilio", "nobody")).toBeUndefined();
    expect(await reader.provider("twilio")).toBeUndefined();
  });

  test("without the installation's public address there is nothing for Twilio to call", async () => {
    const bare = createPhoneProviderReader({
      load: async () => ({ ...settings, phonePublicUrl: "" }),
      key: { state: async () => "none", secret: async () => undefined },
      twilioAccount: async (userId) => accounts[userId],
    });
    expect(await bare.provider("twilio", "ana")).toBeUndefined();
  });

  test("each person gets their own provider, the same one while the account is the same", async () => {
    const a1 = await reader.provider("twilio", "ana");
    expect(await reader.provider("twilio", "ana")).toBe(a1);
    expect(await reader.provider("twilio", "bia")).not.toBe(a1);
  });

  test("a webhook is checked at the address of its own account and with its own token", async () => {
    const ana = (await reader.provider("twilio", "ana"))!;
    const bia = (await reader.provider("twilio", "bia"))!;
    const w = signedFor("ana");
    const path = `${TWILIO_VOICE_PATH}/ana`;
    expect(ana.verifyWebhook(w.body, w.headers, { path }).type).toBe("call.initiated");
    // Bia's token does not check Ana's signature, and her address is another path.
    expect(() => bia.verifyWebhook(w.body, w.headers, { path })).toThrow();
    expect(() =>
      bia.verifyWebhook(w.body, w.headers, { path: `${TWILIO_VOICE_PATH}/bia` }),
    ).toThrow();
  });

  test("an account's provider refuses the installation's own addresses, and the other way round", async () => {
    const ana = (await reader.provider("twilio", "ana"))!;
    const legacy = fake.voice(`CA${"2".repeat(32)}`, "+12025550111", "+12025550122");
    expect(() =>
      ana.verifyWebhook(legacy.body, legacy.headers, { path: TWILIO_VOICE_PATH }),
    ).toThrow();
    const own = signedFor("ana");
    const installation = createTwilioProvider({
      accountSid: fake.accountSid,
      authToken: fake.authToken,
      publicUrl: fake.publicUrl,
    });
    expect(() =>
      installation.verifyWebhook(own.body, own.headers, { path: `${TWILIO_VOICE_PATH}/ana` }),
    ).toThrow();
    expect(
      installation.verifyWebhook(legacy.body, legacy.headers, { path: TWILIO_VOICE_PATH }).type,
    ).toBe("call.initiated");
  });

  test("the numbers of an account are pointed at its own addresses", async () => {
    const provider = createTwilioProvider({
      accountSid: fake.accountSid,
      authToken: fake.authToken,
      publicUrl: fake.publicUrl,
      baseUrl: fake.baseUrl,
      owner: "ana",
    });
    fake.held.clear();
    fake.calls.length = 0;
    fake.voiceUrls.clear();
    // Only the addresses are asserted: a held number is routed to the voice and status addresses of this account.
    const e164 = "+12025550133";
    fake.held.set(e164, "PN00000000000000000000000000000077");
    await provider.routeNumber(e164);
    expect(fake.voiceUrls.get("PN00000000000000000000000000000077")).toBe(
      `${fake.publicUrl}${TWILIO_VOICE_PATH}/ana`,
    );
    const sent = JSON.stringify(fake.calls.map((c) => c.form));
    expect(sent).toContain(`${fake.publicUrl}${TWILIO_STATUS_PATH}/ana`);
  });
});

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PHONE_SETTINGS,
  DEFAULT_PHONE_TWILIO_SETTINGS,
  defaultPhoneProvider,
  isTwilioAccountSid,
  phoneIsOn,
  phoneProviderReady,
  phoneSettingsIssue,
  readyPhoneProviders,
  type PhoneAllSettings,
} from "./phone";

const SID = `AC${"0".repeat(32)}`;
const base: PhoneAllSettings = { ...DEFAULT_PHONE_SETTINGS, ...DEFAULT_PHONE_TWILIO_SETTINGS };
const telnyx: PhoneAllSettings = {
  ...base,
  phoneProvider: "telnyx",
  phonePublicKey: "key",
  phonePublicUrl: "https://zetta.example.invalid",
  phoneApplicationId: "app",
};
const twilio: PhoneAllSettings = {
  ...base,
  phoneTwilio: "on",
  phoneTwilioAccountSid: SID,
  phonePublicUrl: "https://zetta.example.invalid",
};
const both: PhoneAllSettings = {
  ...twilio,
  phoneProvider: "telnyx",
  phonePublicKey: "key",
  phoneApplicationId: "app",
};

describe("account sid", () => {
  test("is AC and 32 hex characters", () => {
    expect(isTwilioAccountSid(SID)).toBe(true);
    expect(isTwilioAccountSid(`AC${"aB".repeat(16)}`)).toBe(true);
    expect(isTwilioAccountSid(`AC${"0".repeat(31)}`)).toBe(false);
    expect(isTwilioAccountSid(`AC${"g".repeat(32)}`)).toBe(false);
    expect(isTwilioAccountSid(`SK${"0".repeat(32)}`)).toBe(false);
    expect(isTwilioAccountSid(`${SID} `)).toBe(false);
  });
});

describe("which providers are ready", () => {
  test("nothing is ready by default", () => {
    expect(phoneIsOn(base, { telnyx: "set", twilio: "set" })).toBe(false);
    expect(readyPhoneProviders(base, { telnyx: "set", twilio: "set" })).toEqual([]);
  });
  test("telnyx needs its switch, key material and a readable key", () => {
    expect(phoneProviderReady(telnyx, "set", "telnyx")).toBe(true);
    expect(phoneProviderReady(telnyx, "none", "telnyx")).toBe(false);
    expect(phoneProviderReady(telnyx, "unavailable", "telnyx")).toBe(false);
    expect(phoneProviderReady({ ...telnyx, phoneApplicationId: "" }, "set", "telnyx")).toBe(false);
    expect(phoneProviderReady(telnyx, "set", "twilio")).toBe(false);
  });
  test("twilio needs its switch, a valid Account SID, a public address and a readable token", () => {
    expect(phoneProviderReady(twilio, "set", "twilio")).toBe(true);
    // There is no operator key any more: only a saved, readable key counts.
    expect(phoneProviderReady(twilio, "operator", "twilio")).toBe(false);
    expect(phoneProviderReady(twilio, "none", "twilio")).toBe(false);
    expect(phoneProviderReady({ ...twilio, phoneTwilio: "off" }, "set", "twilio")).toBe(false);
    expect(
      phoneProviderReady({ ...twilio, phoneTwilioAccountSid: "ACnope" }, "set", "twilio"),
    ).toBe(false);
    expect(phoneProviderReady({ ...twilio, phonePublicUrl: "" }, "set", "twilio")).toBe(false);
  });
  test("phone is on when at least one provider is ready", () => {
    expect(phoneIsOn(twilio, { telnyx: "none", twilio: "set" })).toBe(true);
    expect(phoneIsOn(telnyx, { telnyx: "set", twilio: "none" })).toBe(true);
    expect(phoneIsOn(both, { telnyx: "none", twilio: "none" })).toBe(false);
    expect(readyPhoneProviders(both, { telnyx: "set", twilio: "set" })).toEqual([
      "telnyx",
      "twilio",
    ]);
  });
  test("a bare key state is the Telnyx key, as every earlier caller passed it", () => {
    expect(phoneIsOn(telnyx, "set")).toBe(true);
    expect(phoneIsOn(telnyx, "none")).toBe(false);
    expect(phoneIsOn(twilio, "set")).toBe(false);
  });
  test("the default is used when ready, else the one that is ready", () => {
    const keys = { telnyx: "set", twilio: "set" };
    expect(defaultPhoneProvider({ ...both, phoneDefaultProvider: "twilio" }, keys)).toBe("twilio");
    expect(defaultPhoneProvider({ ...both, phoneDefaultProvider: "telnyx" }, keys)).toBe("telnyx");
    expect(
      defaultPhoneProvider(
        { ...both, phoneDefaultProvider: "telnyx" },
        { telnyx: "none", twilio: "set" },
      ),
    ).toBe("twilio");
    expect(defaultPhoneProvider(base, keys)).toBeNull();
  });
});

describe("settings validation", () => {
  test("a settings object without the Twilio part is still valid", () => {
    expect(phoneSettingsIssue(DEFAULT_PHONE_SETTINGS)).toBeNull();
  });
  test("twilio on needs the Account SID and a public address", () => {
    expect(phoneSettingsIssue(twilio)).toBeNull();
    expect(phoneSettingsIssue({ ...twilio, phoneTwilioAccountSid: "" })).toMatch(/Account SID/);
    expect(phoneSettingsIssue({ ...twilio, phonePublicUrl: "" })).toMatch(/public https address/);
  });
  test("the Account SID shape is checked even while twilio is off", () => {
    expect(phoneSettingsIssue({ ...base, phoneTwilioAccountSid: "nope" })).toMatch(/AC/);
  });
  test("the public address must be https for either provider", () => {
    expect(
      phoneSettingsIssue({ ...twilio, phonePublicUrl: "http://zetta.example.invalid" }),
    ).toMatch(/https/);
    expect(
      phoneSettingsIssue({ ...telnyx, phonePublicUrl: "http://zetta.example.invalid" }),
    ).toMatch(/https/);
  });
  test("the default provider must be a provider", () => {
    expect(phoneSettingsIssue({ ...base, phoneDefaultProvider: "vonage" as never })).toMatch(
      /not a phone provider/,
    );
  });
});

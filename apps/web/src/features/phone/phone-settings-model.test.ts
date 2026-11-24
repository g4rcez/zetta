import { describe, expect, test } from "bun:test";

import type { Installation } from "../onboarding/installation-api";
import {
  accessPatch,
  isProblem,
  limitsPatch,
  parseCountries,
  providerPatch,
  savedView,
  statusOf,
  viewOf,
} from "./phone-settings-model";

const none = { networkMode: "local" } as Installation;
const SID = "AC00000000000000000000000000000000";

describe("the view of the settings", () => {
  test("a server older than this page sends none of the fields: they read as off, never a crash", () => {
    expect(savedView(none)).toMatchObject({
      address: "",
      mode: "off",
      countries: [],
      maxNumbers: "5",
      defaultProvider: "telnyx",
    });
  });
  test("a draft wins over what is saved, field by field", () => {
    const v = viewOf({ ...none, phonePublicUrl: "https://a.example.invalid" }, { twilioSid: SID });
    expect(v.address).toBe("https://a.example.invalid");
    expect(v.twilioSid).toBe(SID);
  });
  test("countries are upper case codes, once each", () => {
    expect(parseCountries("br, US;br  gb")).toEqual(["BR", "US", "GB"]);
  });
});

describe("patches", () => {
  const view = savedView(none);
  test("Telnyx needs its key, its public key, its application and an https address, in that order", () => {
    const send = (over: object, secret = "KEY-secret-value-123", keyState = "none" as const) =>
      providerPatch("telnyx", { view: { ...view, ...over }, keyState, secret });
    expect(send({}, "")).toMatchObject({ field: "key" });
    expect(send({})).toMatchObject({ field: "publicKey" });
    expect(send({ telnyxPublicKey: "k" })).toMatchObject({ field: "application" });
    const ok = { telnyxPublicKey: "k", telnyxApplication: "1" };
    expect(send({ ...ok, address: "http://zetta.example.invalid" })).toMatchObject({
      field: "address",
    });
    expect(send({ ...ok, address: "https://zetta.example.invalid/path" })).toMatchObject({
      field: "address",
    });
    // A saved key needs no new one.
    expect(
      isProblem(send({ ...ok, address: "https://zetta.example.invalid" }, "", "set" as never)),
    ).toBe(false);
  });
  test("Twilio sends only its own fields", () => {
    const patch = providerPatch("twilio", {
      view: { ...view, twilioSid: SID, address: "https://zetta.example.invalid" },
      keyState: "set",
      secret: "",
    });
    expect(patch).toEqual({
      phoneTwilio: "on",
      phoneTwilioAccountSid: SID,
      phonePublicUrl: "https://zetta.example.invalid",
    });
    expect(providerPatch("twilio", { view, keyState: "set", secret: "" })).toMatchObject({
      field: "sid",
    });
  });
  test("the access patch carries the default provider only when both are connected", () => {
    const v = {
      ...view,
      mode: "owner_request" as const,
      countries: ["BR", "US"],
      defaultProvider: "twilio" as const,
    };
    expect(accessPatch(v, false)).toEqual({
      phoneRequestMode: "owner_request",
      phoneCountries: "BR, US",
    });
    expect(accessPatch(v, true)).toMatchObject({ phoneDefaultProvider: "twilio" });
  });
  test("limits are whole numbers", () => {
    expect(limitsPatch({ ...view, maxNumbers: "many" })).toMatchObject({ field: "maxNumbers" });
    expect(limitsPatch(view)).toEqual({
      phoneMaxNumbers: 5,
      phoneMaxCallMinutes: 30,
      phoneDailyMinutesPerBot: 60,
      phoneDailyCallsPerBot: 20,
    });
  });
});

describe("the chip", () => {
  test("off, key unavailable, no key or a failed test, and connected", () => {
    expect(statusOf(false, "set", "untested")).toBe("not_connected");
    expect(statusOf(true, "unavailable", "untested")).toBe("key_unavailable");
    expect(statusOf(true, "none", "untested")).toBe("needs_attention");
    expect(statusOf(true, "set", "failed")).toBe("needs_attention");
    expect(statusOf(true, "set", "passed")).toBe("connected");
  });
});

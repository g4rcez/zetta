import { isTwilioAccountSid, type PhoneProviderId } from "@zetta/core/phone";

import type { Installation, PhoneSettingsPatch } from "../onboarding/installation-api";

export type KeyState = NonNullable<Installation["phoneKey"]>;
export type RequestMode = NonNullable<Installation["phoneRequestMode"]>;

export const TELNYX_PRICING = "https://telnyx.com/pricing/numbers";
export const TELNYX_VOICE_PRICING = "https://telnyx.com/pricing/voice-api";
export const TWILIO_PRICING = "https://www.twilio.com/en-us/voice/pricing/us";

/** How a provider card reads to the administrator. */
export type CardStatus = "not_connected" | "connected" | "key_unavailable" | "needs_attention";
export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  not_connected: "Not connected",
  connected: "Connected",
  key_unavailable: "Key unavailable",
  needs_attention: "Needs attention",
};
/** What the last Test said about a provider. */
export type TestVerdict = "untested" | "passed" | "failed";

/** The part of the page a sentence belongs to. */
export type Area = PhoneProviderId | "access" | "limits";
/** The field a sentence is about, or the whole part. */
export type PhoneField =
  | "form"
  | "key"
  | "publicKey"
  | "application"
  | "sid"
  | "address"
  | "mode"
  | "countries"
  | "maxNumbers"
  | "maxCallMinutes"
  | "dailyMinutes"
  | "dailyCalls";
export type Problem = { field: PhoneField; text: string };
export type Note = { kind: "ok" | "error"; field: PhoneField; text: string };

/** What a provider is good for, in one line (docs/operations/phone.md). */
export const GOOD_FOR: Record<PhoneProviderId, string> = {
  telnyx: "Brazilian numbers for individuals, and low prices.",
  twilio: "Company accounts and US numbers.",
};

export const MODE_CHOICES: { value: RequestMode; label: string; hint: string }[] = [
  { value: "off", label: "Nobody", hint: "No one can ask for a number." },
  { value: "owner_request", label: "Owners ask", hint: "The number is bought at once." },
  {
    value: "operator_approval",
    label: "Administrator approves",
    hint: "An administrator says yes first.",
  },
];

/** What the person is typing and has not saved yet. A field that is not here shows what is saved. */
export type Drafts = {
  address?: string;
  telnyxPublicKey?: string;
  telnyxApplication?: string;
  twilioSid?: string;
  mode?: RequestMode;
  countries?: string[];
  defaultProvider?: PhoneProviderId;
  maxNumbers?: string;
  maxCallMinutes?: string;
  dailyMinutes?: string;
  dailyCalls?: string;
};

/** The settings as the page shows them: a draft where there is one, else what is saved. A server older than this page reads as off. */
export type PhoneView = {
  address: string;
  telnyxPublicKey: string;
  telnyxApplication: string;
  twilioSid: string;
  mode: RequestMode;
  countries: string[];
  defaultProvider: PhoneProviderId;
  maxNumbers: string;
  maxCallMinutes: string;
  dailyMinutes: string;
  dailyCalls: string;
};

/** Two-letter codes, upper case, once each. */
export function parseCountries(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[\s,;]+/)) {
    const code = part.trim().toUpperCase();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export function savedView(s: Installation): PhoneView {
  return {
    address: s.phonePublicUrl ?? "",
    telnyxPublicKey: s.phonePublicKey ?? "",
    telnyxApplication: s.phoneApplicationId ?? "",
    twilioSid: s.phoneTwilioAccountSid ?? "",
    mode: s.phoneRequestMode ?? "off",
    countries: parseCountries(s.phoneCountries),
    defaultProvider: s.phoneDefaultProvider ?? "telnyx",
    maxNumbers: String(s.phoneMaxNumbers ?? 5),
    maxCallMinutes: String(s.phoneMaxCallMinutes ?? 30),
    dailyMinutes: String(s.phoneDailyMinutesPerBot ?? 60),
    dailyCalls: String(s.phoneDailyCallsPerBot ?? 20),
  };
}

export function viewOf(saved: Installation, drafts: Drafts): PhoneView {
  const base = savedView(saved);
  const out: PhoneView = { ...base };
  for (const key of Object.keys(drafts) as (keyof Drafts)[]) {
    const v = drafts[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** The draft fields that really differ from what is saved. */
export function changedFields(saved: Installation, drafts: Drafts): (keyof PhoneView)[] {
  const base = savedView(saved);
  const view = viewOf(saved, drafts);
  return (Object.keys(base) as (keyof PhoneView)[]).filter(
    (k) => JSON.stringify(base[k]) !== JSON.stringify(view[k]),
  );
}

export const isOn = (s: Installation, id: PhoneProviderId) =>
  id === "telnyx" ? (s.phoneProvider ?? "off") !== "off" : s.phoneTwilio === "on";
export const keyStateOf = (s: Installation, id: PhoneProviderId): KeyState =>
  (id === "telnyx" ? s.phoneKey : s.phoneTwilioKey) ?? "none";

export function statusOf(on: boolean, key: KeyState, verdict: TestVerdict): CardStatus {
  if (!on) return "not_connected";
  if (key === "unavailable") return "key_unavailable";
  if (key === "none" || verdict === "failed") return "needs_attention";
  return "connected";
}

/** The fields that belong to each provider's card. The address is shared by both. */
export const CARD_FIELDS: Record<PhoneProviderId, (keyof PhoneView)[]> = {
  telnyx: ["address", "telnyxPublicKey", "telnyxApplication"],
  twilio: ["address", "twilioSid"],
};

const count = (v: string) => (/^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : undefined);
const ADDRESS_OK = /^https:\/\/[^/\s]+\/?$/;

type ProviderInput = { view: PhoneView; keyState: KeyState; secret: string };

/** The patch that connects (or updates) one provider, or the sentence that says what is missing and where. */
export function providerPatch(id: PhoneProviderId, i: ProviderInput): PhoneSettingsPatch | Problem {
  const { view } = i;
  if (id === "telnyx") {
    if (i.keyState !== "set" && i.secret.length < 8)
      return { field: "key", text: "Paste the Telnyx API key." };
    if (!view.telnyxPublicKey.trim())
      return { field: "publicKey", text: "Give the provider's public key." };
    if (!view.telnyxApplication.trim())
      return { field: "application", text: "Give the id of the call application." };
  } else {
    if (!isTwilioAccountSid(view.twilioSid.trim()))
      return {
        field: "sid",
        text: "The Twilio Account SID starts with AC and has 34 letters and digits.",
      };
    if (i.keyState !== "set" && i.secret.length < 8)
      return { field: "key", text: "Paste the Twilio Auth Token." };
  }
  if (!ADDRESS_OK.test(view.address.trim()))
    return {
      field: "address",
      text: "The public address must start with https:// and have no path.",
    };
  return id === "telnyx"
    ? {
        phoneProvider: "telnyx",
        phonePublicKey: view.telnyxPublicKey.trim(),
        phoneApplicationId: view.telnyxApplication.trim(),
        phonePublicUrl: view.address.trim(),
      }
    : {
        phoneTwilio: "on",
        phoneTwilioAccountSid: view.twilioSid.trim(),
        phonePublicUrl: view.address.trim(),
      };
}

export const isProblem = (v: PhoneSettingsPatch | Problem): v is Problem =>
  "field" in v && "text" in v;

/** Who can ask and where. The default provider travels only when both are connected. */
export function accessPatch(view: PhoneView, both: boolean): PhoneSettingsPatch {
  return {
    phoneRequestMode: view.mode,
    phoneCountries: view.countries.join(", "),
    ...(both ? { phoneDefaultProvider: view.defaultProvider } : {}),
  };
}

const LIMITS = [
  ["phoneMaxNumbers", "maxNumbers", "The most numbers"],
  ["phoneMaxCallMinutes", "maxCallMinutes", "Minutes per call"],
  ["phoneDailyMinutesPerBot", "dailyMinutes", "Minutes a day per bot"],
  ["phoneDailyCallsPerBot", "dailyCalls", "Calls a day per bot"],
] as const;

export function limitsPatch(view: PhoneView): PhoneSettingsPatch | Problem {
  const out: Record<string, number> = {};
  for (const [key, field, label] of LIMITS) {
    const n = count(view[field]);
    if (n === undefined) return { field, text: `${label} must be a whole number.` };
    out[key] = n;
  }
  return out as PhoneSettingsPatch;
}

/** Countries a person can pick from; any other code that is already saved still shows as a chip. */
export const COUNTRY_CHOICES = [
  "AR",
  "AU",
  "BR",
  "CA",
  "CL",
  "CO",
  "DE",
  "ES",
  "FR",
  "GB",
  "IE",
  "IN",
  "IT",
  "JP",
  "MX",
  "NL",
  "NZ",
  "PT",
  "US",
  "ZA",
] as const;

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

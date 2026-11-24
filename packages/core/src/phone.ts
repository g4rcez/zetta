/**
 * Phone numbers for bots: what the administrator chose for the whole installation, and the words a number is described with. The columns
 * live on `installation_settings` (`phone_*`); the provider's API key is a sealed connection, never a column. See
 * docs/decisions/voice-and-phone.md and docs/operations/phone.md.
 *
 * Only erasable syntax here: the database schema, the server and the web app all import this file.
 */

/** `off`: bots get no phone numbers. `telnyx`: numbers and calls through the operator's Telnyx account. */
export const PHONE_PROVIDERS = ["off", "telnyx"] as const;
export type PhoneProviderName = (typeof PHONE_PROVIDERS)[number];
export const DEFAULT_PHONE_PROVIDER: PhoneProviderName = "off";

/**
 * The providers a number can belong to, one at a time per number. `phone_provider` (`off | telnyx`) is the Telnyx switch and was kept as
 * it is; Twilio has its own switch (`phone_twilio`) so both can be set up at once.
 */
export const PHONE_PROVIDER_IDS = ["telnyx", "twilio"] as const;
export type PhoneProviderId = (typeof PHONE_PROVIDER_IDS)[number];
export const DEFAULT_PHONE_DEFAULT_PROVIDER: PhoneProviderId = "telnyx";
/** `phone_number.provider`: the provider of one number (`off` is legacy and never written). */
export const PHONE_NUMBER_PROVIDERS = ["off", "telnyx", "twilio"] as const;
export const isPhoneProviderId = (v: unknown): v is PhoneProviderId =>
  (PHONE_PROVIDER_IDS as readonly unknown[]).includes(v);
/** The Twilio switch. */
export const PHONE_TWILIO_SWITCHES = ["off", "on"] as const;
export type PhoneTwilioSwitch = (typeof PHONE_TWILIO_SWITCHES)[number];
/** A Twilio Account SID: `AC` and 32 hex characters. Not a secret (the Auth Token is). */
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
export const isTwilioAccountSid = (v: string) => ACCOUNT_SID.test(v);

/**
 * Who may ask for a number. `off`: nobody. `owner_request`: the owner of a bot asks and the number is ordered at once.
 * `operator_approval`: the owner asks, an administrator approves, and only then is the number ordered (each number costs money every month).
 */
export const PHONE_REQUEST_MODES = ["off", "owner_request", "operator_approval"] as const;
export type PhoneRequestMode = (typeof PHONE_REQUEST_MODES)[number];

/** `requested`: waiting for an administrator (approval mode). `pending_review`: ordered, the regulator or carrier is still reviewing. */
export const PHONE_NUMBER_STATUSES = [
  "requested",
  "pending_review",
  "active",
  "held",
  "released",
  "failed",
] as const;
export type PhoneNumberStatus = (typeof PHONE_NUMBER_STATUSES)[number];
/** The statuses in which a bot already has its number (or a request for one): at most one per bot. */
export const PHONE_OPEN_STATUSES = ["requested", "pending_review", "active"] as const;

/** Who may call the bot's number. `owner_only`: only the owner (proved with the keypad PIN). `off`: calls get "not in service". */
export const PHONE_INBOUND_MODES = ["anyone", "owner_only", "off"] as const;
export type PhoneInboundMode = (typeof PHONE_INBOUND_MODES)[number];
/** Whether the bot may place calls with this number. */
export const PHONE_OUTBOUND_MODES = ["on", "off"] as const;
export type PhoneOutboundMode = (typeof PHONE_OUTBOUND_MODES)[number];

/** Why a number is on the installation-wide do-not-call list: a closed list, never free text. */
export const PHONE_OPTOUT_REASONS = ["caller_request", "operator", "complaint"] as const;
export type PhoneOptoutReason = (typeof PHONE_OPTOUT_REASONS)[number];

/** Days a number is kept (and keeps costing) after its bot is archived, before it is released. */
export const PHONE_HOLD_DAYS = 30;
/** Wrong keypad PIN tries before the PIN is locked, and for how long. */
export const PIN_MAX_FAILURES = 3;
export const PIN_LOCK_MINUTES = 30;
export const PIN_LENGTH = { min: 4, max: 8 } as const;

/** Ranges the installation's limits may take (also CHECKs in the database). */
export const PHONE_LIMITS = {
  maxNumbers: { min: 0, max: 1000 },
  maxCallMinutes: { min: 1, max: 240 },
  dailyMinutesPerBot: { min: 0, max: 1440 },
  dailyCallsPerBot: { min: 0, max: 1000 },
  publicUrl: 512,
  publicKey: 200,
  applicationId: 100,
  accountSid: 34,
  countries: 200,
} as const;

/** The sealed key of the installation's phone provider: a `connection` of this provider, saved with this transport purpose. */
export const PHONE_KEY_CONNECTION_PROVIDER = "phone";
export const PHONE_KEY_PURPOSE = "installation.phone-key";

/** The sealed Auth Token of the installation's Twilio account: a `connection` of this provider, saved with this transport purpose. */
export const PHONE_TWILIO_KEY_CONNECTION_PROVIDER = "phonetwilio";
export const PHONE_TWILIO_KEY_PURPOSE = "installation.phone-twilio-key";

/** The Twilio part of the phone settings (columns `phone_twilio*`, `phone_default_provider`). The Telnyx part is `PhoneSettings`. */
export type PhoneTwilioSettings = {
  phoneTwilio: PhoneTwilioSwitch;
  /** The Account SID (public by design: it is the user name of the API; the Auth Token is the sealed key). */
  phoneTwilioAccountSid: string;
  /** The provider a request uses when it does not name one and that provider is ready. */
  phoneDefaultProvider: PhoneProviderId;
};
export const DEFAULT_PHONE_TWILIO_SETTINGS: PhoneTwilioSettings = {
  phoneTwilio: "off",
  phoneTwilioAccountSid: "",
  phoneDefaultProvider: DEFAULT_PHONE_DEFAULT_PROVIDER,
};
/** Every phone setting of an installation. Functions below take the Twilio part as optional so a caller that only knows Telnyx still works. */
export type PhoneAllSettings = PhoneSettings & PhoneTwilioSettings;
type PhoneSettingsInput = PhoneSettings & Partial<PhoneTwilioSettings>;
/** The state of each provider's sealed key (`InstallationKeyState` of the connection each one records). */
export type PhoneKeyStates = { telnyx: string; twilio: string };

export type PhoneSettings = {
  phoneProvider: PhoneProviderName;
  /** The provider's public key for webhook signatures (public by design). */
  phonePublicKey: string;
  /** The https address the provider calls (webhooks) and connects to (media). Empty while off. */
  phonePublicUrl: string;
  /** The provider's id of the call application the numbers belong to (Telnyx: Call Control application id). Not a secret. */
  phoneApplicationId: string;
  phoneRequestMode: PhoneRequestMode;
  /** Upper case ISO country codes, comma separated: where numbers may be ordered. Empty: none. */
  phoneCountries: string;
  phoneMaxNumbers: number;
  phoneMaxCallMinutes: number;
  phoneDailyMinutesPerBot: number;
  phoneDailyCallsPerBot: number;
};
export const DEFAULT_PHONE_SETTINGS: PhoneSettings = {
  phoneProvider: DEFAULT_PHONE_PROVIDER,
  phonePublicKey: "",
  phonePublicUrl: "",
  phoneApplicationId: "",
  phoneRequestMode: "off",
  phoneCountries: "",
  phoneMaxNumbers: 5,
  phoneMaxCallMinutes: 30,
  phoneDailyMinutesPerBot: 60,
  phoneDailyCallsPerBot: 20,
};

const E164 = /^\+[1-9][0-9]{6,14}$/;
export const isE164 = (v: string) => E164.test(v);
/** A number as typed ("+55 (11) 91234-5678") as E.164 ("+5511912345678"), or undefined when it cannot be one. */
export function normalizeE164(raw: string): string | undefined {
  const digits = raw.trim().replace(/[\s().-]/g, "");
  return E164.test(digits) ? digits : undefined;
}

const COUNTRY = /^[A-Z]{2}$/;
export const isCountryCode = (v: string) => COUNTRY.test(v);
/** "br, us" as "BR,US": upper case, no blanks, no repeats, sorted. Unknown shapes are dropped. */
export const normalizeCountries = (raw: string) =>
  [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((c) => c.trim().toUpperCase())
        .filter(isCountryCode),
    ),
  ]
    .sort()
    .join(",");
export const countryList = (raw: string) => (raw ? raw.split(",").filter(isCountryCode) : []);

/** A public base address as stored: an `https` origin with no path. Undefined when it is not one. */
export function normalizePublicUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return undefined;
    if (u.pathname !== "/") return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

const inRange = (n: number, r: { min: number; max: number }) =>
  Number.isInteger(n) && n >= r.min && n <= r.max;

/** Why a set of phone settings cannot be saved, or null. A provider other than `off` needs its public key and a public address. */
export function phoneSettingsIssue(s: PhoneSettingsInput): string | null {
  if (!(PHONE_PROVIDERS as readonly string[]).includes(s.phoneProvider))
    return "That is not a phone provider.";
  if (!(PHONE_REQUEST_MODES as readonly string[]).includes(s.phoneRequestMode))
    return "That is not a way to ask for numbers.";
  if (s.phonePublicKey.length > PHONE_LIMITS.publicKey) return "The public key is too long.";
  if (s.phoneApplicationId.length > PHONE_LIMITS.applicationId)
    return "The application id is too long.";
  if (s.phoneCountries.length > PHONE_LIMITS.countries) return "Too many countries.";
  if (s.phoneCountries && countryList(s.phoneCountries).length === 0)
    return "Give countries as two-letter codes, for example BR, US.";
  if (s.phonePublicUrl && !normalizePublicUrl(s.phonePublicUrl))
    return "The public address must be an https address with no path, for example https://zetta.example.com.";
  if (!inRange(s.phoneMaxNumbers, PHONE_LIMITS.maxNumbers))
    return "The most numbers must be between 0 and 1000.";
  if (!inRange(s.phoneMaxCallMinutes, PHONE_LIMITS.maxCallMinutes))
    return "A call may last between 1 and 240 minutes.";
  if (!inRange(s.phoneDailyMinutesPerBot, PHONE_LIMITS.dailyMinutesPerBot))
    return "Daily minutes per bot must be between 0 and 1440.";
  if (!inRange(s.phoneDailyCallsPerBot, PHONE_LIMITS.dailyCallsPerBot))
    return "Daily calls per bot must be between 0 and 1000.";
  if (
    s.phoneTwilio !== undefined &&
    !(PHONE_TWILIO_SWITCHES as readonly string[]).includes(s.phoneTwilio)
  )
    return "That is not a way to switch Twilio on.";
  if (s.phoneDefaultProvider !== undefined && !isPhoneProviderId(s.phoneDefaultProvider))
    return "That is not a phone provider.";
  const sid = s.phoneTwilioAccountSid ?? "";
  if (sid && !isTwilioAccountSid(sid))
    return "The Twilio Account SID starts with AC and has 34 characters.";
  if (s.phoneProvider !== "off") {
    if (!s.phonePublicKey) return "Give the provider's public key for webhook signatures.";
    if (!s.phonePublicUrl) return "Give the public https address the provider will call.";
    if (!s.phoneApplicationId) return "Give the id of the provider's call application.";
  }
  if (s.phoneTwilio === "on") {
    if (!sid) return "Give the Twilio Account SID.";
    if (!s.phonePublicUrl) return "Give the public https address Twilio will call.";
  }
  return null;
}

/**
 * Whether one provider has everything it needs. Telnyx: its switch, its public key, a public address, a call application and a readable
 * key. Twilio: its switch, the Account SID, a public address and a readable Auth Token. `keyState` is the state of that provider's key.
 */
export function phoneProviderReady(
  s: PhoneSettingsInput,
  keyState: string,
  id: PhoneProviderId,
): boolean {
  const readable = keyState === "set";
  if (id === "telnyx")
    return (
      s.phoneProvider === "telnyx" &&
      s.phonePublicKey !== "" &&
      s.phonePublicUrl !== "" &&
      s.phoneApplicationId !== "" &&
      readable
    );
  return (
    s.phoneTwilio === "on" &&
    isTwilioAccountSid(s.phoneTwilioAccountSid ?? "") &&
    s.phonePublicUrl !== "" &&
    readable
  );
}

/** The providers that are ready, in the order Telnyx, Twilio. */
export const readyPhoneProviders = (s: PhoneSettingsInput, keys: PhoneKeyStates | string) =>
  PHONE_PROVIDER_IDS.filter((id) =>
    phoneProviderReady(
      s,
      typeof keys === "string" ? (id === "telnyx" ? keys : "none") : keys[id],
      id,
    ),
  );

/** The provider a request uses when it names none: the saved default if it is ready, else the only (or first) ready one. */
export function defaultPhoneProvider(
  s: PhoneSettingsInput,
  keys: PhoneKeyStates | string,
): PhoneProviderId | null {
  const ready = readyPhoneProviders(s, keys);
  const wanted = s.phoneDefaultProvider ?? DEFAULT_PHONE_DEFAULT_PROVIDER;
  return ready.includes(wanted) ? wanted : (ready[0] ?? null);
}

/**
 * Phone numbers are on when at least one provider is ready. A bare string is the state of the Telnyx key (the call every earlier caller
 * made).
 */
export const phoneIsOn = (s: PhoneSettingsInput, keys: PhoneKeyStates | string) =>
  readyPhoneProviders(s, keys).length > 0;

/** What a bot owner is told about a number that is not active yet, by country (reviews of Brazilian numbers take longer). */
export function reviewNotice(country: string): string {
  return country === "BR"
    ? "Being approved: this can take up to 3 business days."
    : "Being approved: this can take a short while.";
}

/** The fixed sentence every call opens with. Its words are not the bot's to change. */
export const PHONE_DISCLOSURE = "Hello, this is an automated assistant speaking for {owner}.";

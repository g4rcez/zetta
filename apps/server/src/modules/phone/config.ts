import {
  countryList,
  defaultPhoneProvider,
  isPhoneProviderId,
  phoneIsOn,
  readyPhoneProviders,
  type PhoneAllSettings,
  type PhoneKeyStates,
  type PhoneProviderId,
  type PhoneRequestMode,
} from "@zetta/core/phone";
import type { InstallationKeyReader, InstallationKeyState } from "../connections/installation-key";
import type { InstallationSettings } from "../installation/service";
import type { PhoneProvider } from "./provider";
import { createTelnyxProvider } from "./telnyx";
import { createTwilioProvider } from "./twilio";

/** The phone columns of the installation settings, and nothing else. */
export const phoneSettingsOf = (s: InstallationSettings): PhoneAllSettings => ({
  phoneProvider: s.phoneProvider,
  phonePublicKey: s.phonePublicKey,
  phonePublicUrl: s.phonePublicUrl,
  phoneApplicationId: s.phoneApplicationId,
  phoneRequestMode: s.phoneRequestMode,
  phoneCountries: s.phoneCountries,
  phoneMaxNumbers: s.phoneMaxNumbers,
  phoneMaxCallMinutes: s.phoneMaxCallMinutes,
  phoneDailyMinutesPerBot: s.phoneDailyMinutesPerBot,
  phoneDailyCallsPerBot: s.phoneDailyCallsPerBot,
  phoneTwilio: s.phoneTwilio ?? "off",
  phoneTwilioAccountSid: s.phoneTwilioAccountSid ?? "",
  phoneDefaultProvider: s.phoneDefaultProvider ?? "telnyx",
});

export type PhoneOffer = {
  /** At least one provider is ready: its switch, its settings and a readable key. */
  on: boolean;
  mode: PhoneRequestMode;
  countries: string[];
  maxNumbers: number;
  /** (Both are always filled by the reader; a stand-in that leaves them out offers Telnyx alone.) The providers a number can be asked from, with the countries each may serve (the operator's one list of countries). */
  providers?: { id: PhoneProviderId; countries: string[] }[];
  /** What a request without a provider uses: the saved default if it is ready, else the only ready one. Null: none is ready. */
  defaultProvider?: PhoneProviderId | null;
};

/**
 * What phone numbers read, on every call, so a change in Studio applies at once (the way `mail/provider-config.ts` does). The same in
 * every `ZETTA_ROLE`. A key is opened only to build a provider for one use and never leaves this file. Both providers can be ready at
 * once; each number says which one it belongs to (`provider(id)`, `providerFor(row)`).
 */
export function createPhoneProviderReader(deps: {
  load: () => Promise<InstallationSettings>;
  /** The Telnyx key. */
  key: InstallationKeyReader;
  /** The Twilio Auth Token. Without it Twilio is never ready. */
  twilioKey?: InstallationKeyReader;
  /** Replaceable so a test talks to a fake provider. */
  create?: (s: PhoneAllSettings, apiKey: string) => PhoneProvider | undefined;
  createTwilio?: (s: PhoneAllSettings, authToken: string) => PhoneProvider | undefined;
}) {
  const create =
    deps.create ??
    ((s: PhoneAllSettings, apiKey: string) =>
      s.phoneProvider === "telnyx"
        ? createTelnyxProvider({
            apiKey,
            publicKey: s.phonePublicKey,
            connectionRef: s.phoneApplicationId,
          })
        : undefined);
  const createTwilio =
    deps.createTwilio ??
    ((s: PhoneAllSettings, authToken: string) =>
      s.phoneTwilio === "on" && s.phoneTwilioAccountSid && s.phonePublicUrl
        ? createTwilioProvider({
            accountSid: s.phoneTwilioAccountSid,
            authToken,
            publicUrl: s.phonePublicUrl,
          })
        : undefined);
  // One provider per (settings, key) so the memory of a provider (Twilio's pending answers) survives from one request to the next.
  const cached = new Map<PhoneProviderId, { id: string; provider: PhoneProvider }>();
  const keyStates = async (s: InstallationSettings): Promise<PhoneKeyStates> => ({
    telnyx: await deps.key.state(s.phoneConnectionId),
    twilio: deps.twilioKey
      ? await deps.twilioKey.state(s.phoneTwilioConnectionId ?? null)
      : ("none" as InstallationKeyState),
  });

  async function build(s: InstallationSettings, id: PhoneProviderId) {
    const settings = phoneSettingsOf(s);
    if (id === "telnyx" ? settings.phoneProvider === "off" : settings.phoneTwilio !== "on")
      return undefined;
    const reader = id === "telnyx" ? deps.key : deps.twilioKey;
    const connection = id === "telnyx" ? s.phoneConnectionId : (s.phoneTwilioConnectionId ?? null);
    const secret = await reader?.secret(connection);
    if (!secret) return undefined;
    try {
      const cacheId =
        id === "telnyx"
          ? [
              settings.phoneProvider,
              settings.phonePublicKey,
              settings.phoneApplicationId,
              s.phoneConnectionId,
            ].join("|")
          : [
              settings.phoneTwilio,
              settings.phoneTwilioAccountSid,
              settings.phonePublicUrl,
              s.phoneTwilioConnectionId,
            ].join("|");
      const have = cached.get(id);
      if (have?.id === cacheId) return have.provider;
      const provider = (id === "telnyx" ? create : createTwilio)(settings, secret.toString("utf8"));
      if (provider) cached.set(id, { id: cacheId, provider });
      else cached.delete(id);
      return provider;
    } finally {
      secret.fill(0);
    }
  }

  return {
    settings: async (): Promise<PhoneAllSettings> => phoneSettingsOf(await deps.load()),
    /** The state of the Telnyx key (what the earlier single-provider code asked for). */
    keyState: async (): Promise<InstallationKeyState> =>
      deps.key.state((await deps.load()).phoneConnectionId),
    keyStates: async (): Promise<PhoneKeyStates> => keyStates(await deps.load()),
    async offer(): Promise<PhoneOffer> {
      const s = await deps.load();
      const settings = phoneSettingsOf(s);
      const keys = await keyStates(s);
      const on = phoneIsOn(settings, keys);
      const countries = on ? countryList(s.phoneCountries) : [];
      return {
        on,
        mode: on ? s.phoneRequestMode : "off",
        countries,
        maxNumbers: s.phoneMaxNumbers,
        providers: readyPhoneProviders(settings, keys).map((id) => ({ id, countries })),
        defaultProvider: defaultPhoneProvider(settings, keys),
      };
    },
    /**
     * The provider with this id, or undefined when it is off or has no readable key. With no id: the default one when it is ready, else
     * the other one (so a caller that does not care which gets one).
     */
    async provider(id?: PhoneProviderId): Promise<PhoneProvider | undefined> {
      const s = await deps.load();
      if (id) return build(s, id);
      const keys = await keyStates(s);
      const first = defaultPhoneProvider(phoneSettingsOf(s), keys);
      if (first) return build(s, first);
      return (await build(s, "telnyx")) ?? (await build(s, "twilio"));
    },
    /** The provider that handles one number: the one its row names. */
    async providerFor(row: { provider: string }): Promise<PhoneProvider | undefined> {
      return isPhoneProviderId(row.provider) ? this.provider(row.provider) : undefined;
    },
  };
}
export type PhoneProviderReader = ReturnType<typeof createPhoneProviderReader>;

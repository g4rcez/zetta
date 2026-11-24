import { queryOptions } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { call, sendSealed } from "../chat/chat-client";
import { STATIC } from "@/lib/query-policy";
import type { MailProviderName } from "@zetta/core/mail-provision";
import type { PhoneProviderId, PhoneSettings, PhoneTwilioSettings } from "@zetta/core/phone";
import type { SpeechSettings } from "@zetta/core/speech";

export type NetworkMode = "local" | "network";
export type Installation = SpeechSettings & {
  networkMode: NetworkMode;
  publicUrl: string | null;
  onboarding: "pending" | "done";
  /** Builtin Laya decision model (plugin). On by default. */
  laya: "on" | "off";
  /** BCP-47 tags the Laya model must understand ("en" is always first). */
  layaLanguages: string[];
  /** The model those languages select: English only, or the multilingual one. */
  layaModel: "english" | "multilingual";
  /** Whether the server checks once a day if a newer version is published. `off` sends nothing anywhere. */
  updateCheck?: "on" | "off";
  /** The saved network mode differs from the one the server booted with. */
  restartRequired: boolean;
  /** Speech to text: the server's own model, OpenAI, or any server that speaks OpenAI's transcription API. */
  transcribeProvider: TranscribeProvider;
  transcribeModel: string;
  /** Two-letter code; empty means the language of the person's browser. */
  transcribeLanguage: string;
  transcribeBaseUrl: string;
  /** The key is never sent here: whether one is saved, or the saved one cannot be read any more. */
  transcribeKey: "none" | "set" | "unavailable";
  /** Text to speech: whether a key is saved (never the key). Older servers send none. */
  speechKey?: "none" | "set" | "unavailable";
  /** Bot e-mail addresses: the provider, the domain the addresses live on, and whether a key is saved (never the key). Older servers send none. */
  mailProvider?: MailProviderName;
  mailDomain?: string;
  mailKey?: "none" | "set" | "unavailable";
  /** Phone numbers for bots: the provider, its public pieces and the limits, and whether a key is saved (never the key). Older servers send none. */
  phoneProvider?: PhoneSettings["phoneProvider"];
  phonePublicKey?: string;
  phonePublicUrl?: string;
  phoneApplicationId?: string;
  phoneRequestMode?: PhoneSettings["phoneRequestMode"];
  phoneCountries?: string;
  phoneMaxNumbers?: number;
  phoneMaxCallMinutes?: number;
  phoneDailyMinutesPerBot?: number;
  phoneDailyCallsPerBot?: number;
  phoneKey?: "none" | "set" | "unavailable";
  /** The shared WhatsApp server (WAHA): whether its key is saved (never the key). Its address is the setting `wahaUrl`. */
  wahaKey?: "none" | "set" | "unavailable";
  /** Twilio next to Telnyx: its switch, the Account SID (public), whether an Auth Token is saved (never the token) and the default provider. */
  phoneTwilio?: PhoneTwilioSettings["phoneTwilio"];
  phoneTwilioAccountSid?: string;
  phoneTwilioKey?: "none" | "set" | "unavailable";
  phoneDefaultProvider?: PhoneTwilioSettings["phoneDefaultProvider"];
  /** The public key of the installation's push messages; null until the server made one. The private key never leaves the server. */
  pushPublicKey: string | null;
};
/** `off`: no recording or voice note is turned into text. */
export type TranscribeProvider = "off" | "local" | "openai" | "compatible";
export type TranscribeSettingsPatch = Partial<
  Pick<
    Installation,
    "transcribeProvider" | "transcribeModel" | "transcribeLanguage" | "transcribeBaseUrl"
  >
>;
export type SpeechSettingsPatch = Partial<
  Pick<
    Installation,
    "speechProvider" | "speechModel" | "speechVoice" | "speechLanguage" | "speechBaseUrl"
  >
>;
export type SpeechTest = { ok: boolean; provider?: string; message?: string; seconds?: number };
export type MailSettingsPatch = Partial<Pick<Installation, "mailProvider" | "mailDomain">>;
/** One DNS record the administrator adds at the domain's DNS host, as the provider shows it. */
export type MailDnsRecord = {
  purpose: string;
  type: string;
  name: string;
  value: string;
  priority?: number;
  verified: boolean;
};
export type MailTest = {
  ok: boolean;
  message?: string;
  state?: string;
  sending?: boolean;
  receiving?: boolean;
  records?: MailDnsRecord[];
};
export type PhoneSettingsPatch = Partial<
  Pick<
    Installation,
    | "phoneProvider"
    | "phonePublicKey"
    | "phonePublicUrl"
    | "phoneApplicationId"
    | "phoneRequestMode"
    | "phoneCountries"
    | "phoneMaxNumbers"
    | "phoneMaxCallMinutes"
    | "phoneDailyMinutesPerBot"
    | "phoneDailyCallsPerBot"
    | "phoneTwilio"
    | "phoneTwilioAccountSid"
    | "phoneDefaultProvider"
  >
>;
export type PhoneTest = {
  ok: boolean;
  provider?: PhoneProviderId;
  message?: string;
  keyOk?: boolean;
  applicationOk?: boolean;
  balance?: string | null;
  address?: { ok: boolean; message: string };
};
export type WahaTest = { ok: boolean; message?: string };
export type TranscribeTest = { ok: boolean; provider?: TranscribeProvider; message?: string };

export const installationApi = {
  get: () => call<Installation>("/api/installation"),
  /** The answer is the saved installation: it replaces the cached one. */
  patch: (
    patch: Partial<
      Pick<
        Installation,
        "networkMode" | "publicUrl" | "onboarding" | "laya" | "layaLanguages" | "updateCheck"
      >
    > &
      TranscribeSettingsPatch &
      SpeechSettingsPatch &
      MailSettingsPatch &
      PhoneSettingsPatch,
  ) =>
    call<Installation>("/api/installation", "PATCH", patch).then((next) => {
      queryClient.setQueryData(installationQueries.get().queryKey, next);
      return next;
    }),
  /** The key travels sealed to the server's transport key, like every credential; the page never keeps it. */
  saveTranscribeKey: (secret: string) =>
    sendSealed("installation.transcribe-key", { secret }, (sealed) =>
      call<{ ok: true }>("/api/connections/transcribe-key", "PUT", { sealed }),
    ).then(refresh),
  removeTranscribeKey: () =>
    call<{ ok: true }>("/api/connections/transcribe-key", "DELETE").then(refresh),
  /** The text-to-speech key travels sealed the same way. */
  saveSpeechKey: (secret: string) =>
    sendSealed("installation.speech-key", { secret }, (sealed) =>
      call<{ ok: true }>("/api/connections/speech-key", "PUT", { sealed }),
    ).then(refresh),
  removeSpeechKey: () => call<{ ok: true }>("/api/connections/speech-key", "DELETE").then(refresh),
  /** One short sentence through the saved choice: whether the key, the address, the model and the voice work. */
  testSpeech: () => call<SpeechTest>("/api/installation/speech/test", "POST", {}),
  /** The provider's key for bot e-mail addresses travels sealed like every credential; the page never keeps it. */
  saveMailKey: (secret: string) =>
    sendSealed("installation.mail-key", { secret }, (sealed) =>
      call<{ ok: true }>("/api/connections/mail-key", "PUT", { sealed }),
    ).then(refresh),
  removeMailKey: () => call<{ ok: true }>("/api/connections/mail-key", "DELETE").then(refresh),
  /** Reads the saved domain at the provider: whether it sends and receives, and the DNS records still to add. */
  testMail: () => call<MailTest>("/api/installation/mail/test", "POST", {}),
  /** The phone provider's key travels sealed like every credential; the page never keeps it. */
  savePhoneKey: (secret: string) =>
    sendSealed("installation.phone-key", { secret }, (sealed) =>
      call<{ ok: true }>("/api/connections/phone-key", "PUT", { sealed }),
    ).then(refresh),
  removePhoneKey: () => call<{ ok: true }>("/api/connections/phone-key", "DELETE").then(refresh),
  /** The key of the shared WhatsApp server travels sealed like every credential; the page never keeps it. */
  saveWahaKey: (secret: string) =>
    sendSealed("installation.waha-key", { secret }, (sealed) =>
      call<{ ok: true }>("/api/connections/waha-key", "PUT", { sealed }),
    ).then(refresh),
  removeWahaKey: () => call<{ ok: true }>("/api/connections/waha-key", "DELETE").then(refresh),
  /** Asks the shared WhatsApp server for its sessions with the saved address and key. */
  testWaha: () => call<WahaTest>("/api/installation/waha/test", "POST", {}),
  /** The Twilio Auth Token travels sealed the same way, with its own connection. */
  savePhoneTwilioKey: (secret: string) =>
    sendSealed("installation.phone-twilio-key", { secret }, (sealed) =>
      call<{ ok: true }>("/api/connections/phone-twilio-key", "PUT", { sealed }),
    ).then(refresh),
  removePhoneTwilioKey: () =>
    call<{ ok: true }>("/api/connections/phone-twilio-key", "DELETE").then(refresh),
  /** Whether the saved key (and call application, for Telnyx) work at one provider, and whether the public address answers. */
  testPhone: (provider: PhoneProviderId = "telnyx") =>
    call<PhoneTest>("/api/installation/phone/test", "POST", { provider }),
  /** One second of silence through the saved choice: whether the key, the address and the model work. */
  testTranscribe: () => call<TranscribeTest>("/api/installation/transcribe/test", "POST", {}),
};
/** After a change that does not return the installation: read it again into the cache. */
const refresh = async () => {
  const next = await installationApi.get();
  queryClient.setQueryData(installationQueries.get().queryKey, next);
  return next;
};

export const installationQueries = {
  get: () =>
    queryOptions({ queryKey: ["installation"], queryFn: () => installationApi.get(), ...STATIC }),
};

import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { isLayaTag } from "@zetta/core/laya-languages";
import {
  InvalidInstallationError,
  withLayaModel,
  type InstallationService,
  type NetworkMode,
} from "./service";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import { assertPublicUrl } from "../computer/service";
import { privateAllowed, type PrivateNetwork } from "../settings/private-network";
import { languageCode, TranscribeError, type Transcriber } from "../transcribe/transcriber";
import type { UpdateChecker } from "../updates/checker";
import { MAIL_PROVIDERS } from "@zetta/core/mail-provision";
import {
  SPEECH_LIMITS,
  SPEECH_NAME_PATTERN,
  SPEECH_PROVIDERS,
  TRANSCRIBE_PROVIDERS,
} from "@zetta/core/speech";
import { SpeechError } from "../speech/errors";
import type { ConfiguredSynthesizer } from "../speech/configured";
import type { InstallationKeyReader } from "../connections/installation-key";
import { MailConnectError } from "../mail/imap-connect";
import type { MailProviderReader } from "../mail/provider-config";
import {
  PHONE_LIMITS,
  PHONE_PROVIDER_IDS,
  PHONE_PROVIDERS,
  PHONE_REQUEST_MODES,
  PHONE_TWILIO_SWITCHES,
  normalizePublicUrl,
  type PhoneProviderId,
} from "@zetta/core/phone";
import { PhoneProviderError } from "../phone/provider";
import type { PhoneProviderReader } from "../phone/config";

export type InstallationServices = {
  access: ReturnType<typeof createIdentityAccess>;
  installation: InstallationService;
  /** Network mode the process booted with; a saved change applies after a restart. */
  runningMode: NetworkMode;
  /** Speech to text: what the administrator chose is read by `transcriber` itself; these serve the settings card. */
  transcriber?: Transcriber;
  /** Whether a key is there for speech to text: none, or a saved connection (still readable or not). */
  transcribeKey?: {
    state(connectionId: string | null): Promise<"none" | "set" | "unavailable">;
  };
  /** Speech out: what the administrator chose is read by `synthesizer` itself; these serve the settings card and its Test button. */
  speech?: { synthesizer: ConfiguredSynthesizer; key: Pick<InstallationKeyReader, "state"> };
  /** Bot e-mail addresses: the saved choice and its sealed key, for the settings card and its Test button. */
  mail?: { reader: MailProviderReader; key: Pick<InstallationKeyReader, "state"> };
  /** Phone numbers: the saved choice and its sealed key, for the settings card and its Test button. */
  phone?: {
    reader: PhoneProviderReader;
    key: Pick<InstallationKeyReader, "state">;
    /** The Twilio Auth Token's state. Without it Twilio shows no key. */
    twilioKey?: Pick<InstallationKeyReader, "state">;
    /** Replaceable so a test needs no network. Default: https, a public name, and the health route answering. */
    address?: (raw: string) => Promise<{ ok: boolean; message: string }>;
  };
  /** The shared WhatsApp server (WAHA): the state of its sealed key, and a check of the address and key. */
  waha?: {
    key: Pick<InstallationKeyReader, "state">;
    check: () => Promise<{ ok: boolean; message: string }>;
  };
  /** Private network addresses allowed by the administrator (the setting `allowPrivateNetwork`): a provider on the local network, over http. Asked at every check. */
  allowPrivate?: PrivateNetwork;
  /** The daily "newer version" check (modules/updates). */
  updates?: UpdateChecker;
};

const patchInput = z.strictObject({
  networkMode: z.enum(["local", "network"]).optional(),
  publicUrl: z
    .url({ protocol: /^https$/ })
    .max(512)
    .nullable()
    .optional(),
  onboarding: z.enum(["pending", "done"]).optional(),
  laya: z.enum(["on", "off"]).optional(),
  updateCheck: z.enum(["on", "off"]).optional(),
  layaLanguages: z.array(z.string().refine(isLayaTag)).max(64).optional(),
  transcribeProvider: z.enum(TRANSCRIBE_PROVIDERS).optional(),
  transcribeModel: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9._:/-]*$/)
    .optional(),
  // Empty means "the language of the person's browser". A tag ("pt-BR") or a name ("portuguese") is stored as its two-letter code.
  transcribeLanguage: z
    .string()
    .trim()
    .max(35)
    .refine((v) => v === "" || languageCode(v) !== undefined)
    .transform((v) => (v === "" ? "" : languageCode(v)!))
    .optional(),
  transcribeBaseUrl: z.string().trim().max(512).optional(),
  speechProvider: z.enum(SPEECH_PROVIDERS).optional(),
  speechModel: z.string().trim().max(SPEECH_LIMITS.model).regex(SPEECH_NAME_PATTERN).optional(),
  speechVoice: z.string().trim().max(SPEECH_LIMITS.voice).regex(SPEECH_NAME_PATTERN).optional(),
  // Empty means "the language of the text". A tag ("pt-BR") or a name ("portuguese") is stored as its two-letter code.
  speechLanguage: z
    .string()
    .trim()
    .max(SPEECH_LIMITS.language)
    .refine((v) => v === "" || languageCode(v) !== undefined)
    .transform((v) => (v === "" ? "" : languageCode(v)!))
    .optional(),
  speechBaseUrl: z.string().trim().max(SPEECH_LIMITS.baseUrl).optional(),
  mailProvider: z.enum(MAIL_PROVIDERS).optional(),
  mailDomain: z.string().trim().max(253).optional(),
  phoneProvider: z.enum(PHONE_PROVIDERS).optional(),
  phonePublicKey: z.string().trim().max(PHONE_LIMITS.publicKey).optional(),
  phonePublicUrl: z.string().trim().max(PHONE_LIMITS.publicUrl).optional(),
  phoneApplicationId: z
    .string()
    .trim()
    .max(PHONE_LIMITS.applicationId)
    .regex(/^[A-Za-z0-9_.:-]*$/)
    .optional(),
  phoneTwilio: z.enum(PHONE_TWILIO_SWITCHES).optional(),
  phoneTwilioAccountSid: z
    .string()
    .trim()
    .max(PHONE_LIMITS.accountSid)
    .regex(/^(AC[0-9a-fA-F]{32})?$/, "The Account SID starts with AC and has 34 characters.")
    .optional(),
  phoneDefaultProvider: z.enum(PHONE_PROVIDER_IDS).optional(),
  phoneRequestMode: z.enum(PHONE_REQUEST_MODES).optional(),
  phoneCountries: z.string().trim().max(PHONE_LIMITS.countries).optional(),
  phoneMaxNumbers: z
    .number()
    .int()
    .min(PHONE_LIMITS.maxNumbers.min)
    .max(PHONE_LIMITS.maxNumbers.max)
    .optional(),
  phoneMaxCallMinutes: z
    .number()
    .int()
    .min(PHONE_LIMITS.maxCallMinutes.min)
    .max(PHONE_LIMITS.maxCallMinutes.max)
    .optional(),
  phoneDailyMinutesPerBot: z
    .number()
    .int()
    .min(PHONE_LIMITS.dailyMinutesPerBot.min)
    .max(PHONE_LIMITS.dailyMinutesPerBot.max)
    .optional(),
  phoneDailyCallsPerBot: z
    .number()
    .int()
    .min(PHONE_LIMITS.dailyCallsPerBot.min)
    .max(PHONE_LIMITS.dailyCallsPerBot.max)
    .optional(),
});
const TEST_PER_MINUTE = 6;

/** The JSON body of a request, `{}` when there is none (a Test button that names nothing). */
async function optionalJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { provider: "invalid" };
  }
}

export function createInstallationRoutes(
  {
    access,
    installation,
    runningMode,
    transcriber,
    transcribeKey,
    speech,
    mail,
    phone,
    waha,
    allowPrivate,
    updates,
  }: InstallationServices,
  trustedOrigins: readonly string[],
) {
  const testCalls = new Map<string, number[]>();
  const body = async (settings: Awaited<ReturnType<typeof installation.load>>) => ({
    ...withLayaModel(settings),
    restartRequired: settings.networkMode !== runningMode,
    transcribeKey: transcribeKey
      ? await transcribeKey.state(settings.transcribeConnectionId)
      : "none",
    speechKey: speech ? await speech.key.state(settings.speechConnectionId) : "none",
    mailKey: mail ? await mail.key.state(settings.mailConnectionId) : "none",
    phoneKey: phone ? await phone.key.state(settings.phoneConnectionId) : "none",
    wahaKey: waha ? await waha.key.state(settings.wahaConnectionId) : "none",
    phoneTwilioKey: phone?.twilioKey
      ? await phone.twilioKey.state(settings.phoneTwilioConnectionId)
      : "none",
  });
  /** The address of a speech-to-text server is typed by an administrator: https, and not a private network unless the operator allowed it. */
  async function checkBaseUrl(raw: string, what = "speech-to-text") {
    if (!raw) return;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new InvalidInstallationError("That is not a web address.");
    }
    if (u.username || u.password || u.search || u.hash)
      throw new InvalidInstallationError(
        "Give the address without a user name, password or query.",
      );
    const priv = await privateAllowed(allowPrivate);
    if (u.protocol !== "https:" && !(priv && u.protocol === "http:"))
      throw new InvalidInstallationError(`The ${what} address must start with https://.`);
    if (!priv)
      await assertPublicUrl(raw).catch(() => {
        throw new InvalidInstallationError(
          "That address is not allowed: private addresses must be enabled by the operator.",
        );
      });
  }
  /** https, a public name, and Zetta's own health route answering there. It cannot prove the address is open to the provider's servers. */
  async function checkPublicAddress(raw: string): Promise<{ ok: boolean; message: string }> {
    const origin = normalizePublicUrl(raw);
    if (!origin)
      return {
        ok: false,
        message:
          "The public address must be an https address, for example https://zetta.example.com.",
      };
    try {
      await assertPublicUrl(origin);
    } catch {
      return {
        ok: false,
        message:
          "The public address does not resolve to a public internet address. The provider could not reach it.",
      };
    }
    try {
      const res = await fetch(`${origin}/api/phone/health`, {
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && json?.ok === true) return { ok: true, message: "The public address answers." };
    } catch {
      // falls through to the message below
    }
    return {
      ok: false,
      message:
        "Nothing from Zetta answered at the public address. Check the reverse proxy or tunnel sends it to this server.",
    };
  }
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof InvalidInstallationError)
      return fail(400, "INVALID_REQUEST", e.message || "Network mode needs an https public URL.");
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  return (
    new Elysia({ prefix: "/api/installation", normalize: false })
      .get("/", async ({ request }) => {
        try {
          await access.requireActive(request.headers);
          return out(await body(await installation.load()));
        } catch (e) {
          return mapError(e);
        }
      })
      // The build of this server and what the update check knows. Signed in only: `GET /api/meta` stays public and carries no version.
      .get("/version", async ({ request }) => {
        try {
          await access.requireActive(request.headers);
          return out(
            updates
              ? await updates.status()
              : {
                  build: null,
                  state: "unknown",
                  latest: null,
                  changes: [],
                  checkedAt: null,
                  check: "off",
                },
          );
        } catch (e) {
          return mapError(e);
        }
      })
      .patch("/", async ({ request, body: raw }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin)) throw new AccessError("ACCESS_DENIED");
          const patch = patchInput.parse(raw);
          if (patch.transcribeBaseUrl !== undefined) await checkBaseUrl(patch.transcribeBaseUrl);
          if (patch.speechBaseUrl !== undefined)
            await checkBaseUrl(patch.speechBaseUrl, "text-to-speech");
          return out(await body(await installation.update(patch)));
        } catch (e) {
          return mapError(e);
        }
      })
      // Speaks one short sentence with the saved choice: shows the administrator whether the key, the address, the model and the voice work.
      // It costs a fraction of a cent at a provider. With `browser` there is nothing for the server to try. Never says more than the fixed
      // sentence of the error.
      .post("/speech/test", async ({ request }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin) || !speech)
            throw new AccessError("ACCESS_DENIED");
          const now = Date.now();
          const recent = (testCalls.get(`speech:${actor.userId}`) ?? []).filter(
            (t) => now - t < 60_000,
          );
          if (recent.length >= TEST_PER_MINUTE)
            return out({
              ok: false,
              message: "That was a lot of tests. Wait a minute and try again.",
            });
          testCalls.set(`speech:${actor.userId}`, [...recent, now]);
          const settings = await installation.load();
          if (settings.speechProvider === "off")
            return out({
              ok: false,
              message: "Text to speech is switched off. Choose a provider and save first.",
            });
          if (settings.speechProvider === "browser")
            return out({
              ok: true,
              provider: "browser",
              message:
                "The browser speaks on its own device. There is nothing for the server to test.",
            });
          try {
            const pcm = await speech.synthesizer.synthesize("This is a test of text to speech.");
            return out({
              ok: pcm.length > 0,
              provider: settings.speechProvider,
              seconds: Math.round(pcm.length / 1600) / 10,
            });
          } catch (e) {
            if (e instanceof SpeechError) return out({ ok: false, message: e.safe });
            return out({
              ok: false,
              message: "The speech provider could not be reached. Try again in a moment.",
            });
          }
        } catch (e) {
          return mapError(e);
        }
      })
      // Reads the domain at the provider: whether it exists, can send and receive, and the DNS records still to add. Administrators only.
      // It never says more than a fixed sentence about a failure.
      .post("/mail/test", async ({ request }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin) || !mail)
            throw new AccessError("ACCESS_DENIED");
          const now = Date.now();
          const recent = (testCalls.get(`mail:${actor.userId}`) ?? []).filter(
            (t) => now - t < 60_000,
          );
          if (recent.length >= TEST_PER_MINUTE)
            return out({
              ok: false,
              message: "That was a lot of tests. Wait a minute and try again.",
            });
          testCalls.set(`mail:${actor.userId}`, [...recent, now]);
          const offer = await mail.reader.settings();
          if (offer.mailProvider === "off")
            return out({ ok: false, message: "Choose a provider and save first." });
          const provider = await mail.reader.provider();
          if (!provider) return out({ ok: false, message: "Save the provider's key first." });
          try {
            const status = await provider.domainStatus(offer.mailDomain);
            if (!status.found)
              return out({
                ok: false,
                message: `The provider does not know ${offer.mailDomain}. Add the domain there first.`,
              });
            const ready = status.sending && status.receiving;
            return out({
              ok: ready,
              state: status.state,
              sending: status.sending,
              receiving: status.receiving,
              records: status.records,
              message: ready
                ? "The domain can send and receive. Bots get an address on it."
                : !status.receiving
                  ? "Receiving is not enabled for this domain yet. Turn it on at the provider and add the MX record shown below."
                  : "Sending is not enabled for this domain yet. Add the DNS records shown below.",
            });
          } catch (e) {
            return out({
              ok: false,
              message:
                e instanceof MailConnectError
                  ? e.safe
                  : "The mail provider could not be reached. Try again in a moment.",
            });
          }
        } catch (e) {
          return mapError(e);
        }
      })
      // Phone numbers: whether the key and the call application work at the provider, and whether the public address looks reachable.
      // The provider has no way to ask an address from outside, so the address is checked as far as this server can: https, a name that
      // resolves to a public address, and an answer from Zetta's own health route there. Administrators only; fixed sentences only.
      .post("/phone/test", async ({ request }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin) || !phone)
            throw new AccessError("ACCESS_DENIED");
          const now = Date.now();
          const recent = (testCalls.get(`phone:${actor.userId}`) ?? []).filter(
            (t) => now - t < 60_000,
          );
          if (recent.length >= TEST_PER_MINUTE)
            return out({
              ok: false,
              message: "That was a lot of tests. Wait a minute and try again.",
            });
          testCalls.set(`phone:${actor.userId}`, [...recent, now]);
          const settings = await phone.reader.settings();
          const asked = z
            .strictObject({ provider: z.enum(PHONE_PROVIDER_IDS).optional() })
            .parse(await optionalJson(request)).provider;
          // Without a named provider: Telnyx, unless only Twilio is switched on.
          const id: PhoneProviderId =
            asked ??
            (settings.phoneProvider === "off" && settings.phoneTwilio === "on"
              ? "twilio"
              : "telnyx");
          const name = id === "twilio" ? "Twilio" : "Telnyx";
          if (id === "telnyx" ? settings.phoneProvider === "off" : settings.phoneTwilio === "off")
            return out({
              ok: false,
              message:
                id === "telnyx"
                  ? "Choose a provider and save first."
                  : "Switch Twilio on and save first.",
            });
          const provider = await phone.reader.provider(id);
          if (!provider)
            return out({
              ok: false,
              message:
                id === "telnyx"
                  ? "Save the provider's key first."
                  : "Save the Twilio Auth Token first.",
            });
          const address = await (phone.address ?? checkPublicAddress)(settings.phonePublicUrl);
          try {
            const account = await provider.checkAccount();
            const ok = account.keyOk && account.applicationOk && address.ok;
            return out({
              ok,
              provider: id,
              keyOk: account.keyOk,
              applicationOk: account.applicationOk,
              balance: account.balance ?? null,
              address,
              message: !account.keyOk
                ? id === "telnyx"
                  ? "The provider did not accept the saved key."
                  : "Twilio did not accept the Account SID and Auth Token."
                : !account.applicationOk
                  ? id === "telnyx"
                    ? "The provider does not know that call application id. Check it in the provider's portal."
                    : "Twilio would not list the numbers of this account, so webhooks cannot be set. Check the Auth Token's access."
                  : !address.ok
                    ? address.message
                    : id === "telnyx"
                      ? "The key and the call application work, and the public address answers."
                      : `${name} accepted the Account SID and Auth Token, numbers can be managed, and the public address answers.`,
            });
          } catch (e) {
            return out({
              ok: false,
              message:
                e instanceof PhoneProviderError
                  ? e.safe
                  : "The phone provider could not be reached. Try again in a moment.",
            });
          }
        } catch (e) {
          return mapError(e);
        }
      })
      // The shared WhatsApp server: asks it for its list of sessions with the saved address and key (see whatsapp.ts `checkInstallationServer`).
      // Administrators only; fixed sentences only.
      .post("/waha/test", async ({ request }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin) || !waha)
            throw new AccessError("ACCESS_DENIED");
          const now = Date.now();
          const recent = (testCalls.get(`waha:${actor.userId}`) ?? []).filter(
            (t) => now - t < 60_000,
          );
          if (recent.length >= TEST_PER_MINUTE)
            return out({
              ok: false,
              message: "That was a lot of tests. Wait a minute and try again.",
            });
          testCalls.set(`waha:${actor.userId}`, [...recent, now]);
          return out(await waha.check());
        } catch (e) {
          return mapError(e);
        }
      })
      // Tries the chosen speech-to-text with one second of silence: shows the administrator, before anybody records, whether the key, the
      // address and the model work. It costs next to nothing at a provider. Never says more than the fixed sentence of the error.
      .post("/transcribe/test", async ({ request }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          if (!("isAdmin" in actor && actor.isAdmin) || !transcriber)
            throw new AccessError("ACCESS_DENIED");
          const now = Date.now();
          const recent = (testCalls.get(actor.userId) ?? []).filter((t) => now - t < 60_000);
          if (recent.length >= TEST_PER_MINUTE)
            return out({
              ok: false,
              message: "That was a lot of tests. Wait a minute and try again.",
            });
          testCalls.set(actor.userId, [...recent, now]);
          const settings = await installation.load();
          try {
            await transcriber.transcribe(new Float32Array(16_000));
            return out({ ok: true, provider: settings.transcribeProvider });
          } catch (e) {
            if (e instanceof TranscribeError) return out({ ok: false, message: e.safe });
            return out({
              ok: false,
              message: "The speech model could not run. Try again in a moment.",
            });
          }
        } catch (e) {
          return mapError(e);
        }
      })
  );
}

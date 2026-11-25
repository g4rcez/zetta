/**
 * Twilio as the second provider of bot phone numbers. Built from Twilio's public documentation; it has not been run against a real
 * Twilio account (see docs/operations/phone.md). Pages read on 2026-11-23:
 *
 *   webhooks   https://www.twilio.com/docs/voice/twiml (parameters CallSid, AccountSid, From, To, CallStatus, Direction; answer is TwiML)
 *   signature  https://www.twilio.com/docs/usage/webhooks/webhooks-security (`X-Twilio-Signature`, HMAC-SHA1 with the Auth Token over the
 *              exact URL called plus the form parameters sorted by name, each as name then value; base64)
 *   TwiML      https://www.twilio.com/docs/voice/twiml/stream (`<Connect><Stream url="wss://...">`, nested `<Parameter name value>`, no
 *              query string in `url`), https://www.twilio.com/docs/voice/twiml/reject (`<Reject reason="busy">` must be the first verb)
 *   streams    https://www.twilio.com/docs/voice/media-streams/websocket-messages (mu-law 8 kHz base64; `streamSid` on messages sent back)
 *   calls      https://www.twilio.com/docs/voice/api/call-resource   POST /Accounts/{sid}/Calls.json (To, From, Twiml, StatusCallback,
 *              StatusCallbackEvent, MachineDetection, AsyncAmd, AsyncAmdStatusCallback, TimeLimit); POST .../Calls/{sid}.json (Status)
 *   AMD        https://www.twilio.com/docs/voice/answering-machine-detection (`AnsweredBy`)
 *   numbers    https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource   POST|GET .../IncomingPhoneNumbers.json,
 *              POST|DELETE .../IncomingPhoneNumbers/{sid}.json (PhoneNumber, VoiceUrl, StatusCallback, BundleSid, AddressSid)
 *   search     https://www.twilio.com/docs/phone-numbers/api/availablephonenumberlocal-resource   GET .../AvailablePhoneNumbers/{CC}/Local.json
 *   balance    GET .../Balance.json (found through search results; Twilio's own reference page for it did not load)
 *   Brazil     https://www.twilio.com/en-us/guidelines/br/regulatory (local numbers only for businesses; documents; no word on the API)
 *
 * Twilio answers an incoming call in the HTTP response of its webhook (TwiML), not with a later command. The adapter keeps a pending
 * answer per call: `answer` / `reject` fill it, and `reply` hands it to the webhook route, which is still waiting. Nothing a provider
 * says is echoed: every failure is a fixed sentence.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PhoneProviderError,
  WebhookError,
  type AccountCheck,
  type AvailableNumber,
  type CallControlOptions,
  type HeldNumber,
  type PhoneEvent,
  type PhoneProvider,
  type PlaceCall,
  type PlacedCall,
} from "./provider";

export const TWILIO_API = "https://api.twilio.com/2010-04-01";
/** The paths of the two webhooks, under the installation's public address. Twilio signs the full address, so they are part of the check. */
export const TWILIO_VOICE_PATH = "/api/phone/twilio/voice";
export const TWILIO_STATUS_PATH = "/api/phone/twilio/status";
/** How long the voice webhook waits for the call's answer before it refuses the call. Twilio itself gives up on a slow webhook. */
export const TWILIO_REPLY_TIMEOUT_MS = 8_000;

export type TwilioOptions = {
  accountSid: string;
  /** The Auth Token. Sent only as the password of HTTP basic authentication and as the key of the webhook signature. */
  authToken: string;
  /** `https://host`, no path: the address Twilio calls. */
  publicUrl: string;
  /**
   * The person this account belongs to, when it is the Twilio plugin's account (not the installation's own): the webhook addresses end
   * in `/<owner>`, so the right Auth Token is chosen before the signature is checked. Only a webhook at exactly that address verifies.
   */
  owner?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  replyTimeoutMs?: number;
};

const dig = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const header = (h: Headers | Record<string, string | undefined>, name: string) =>
  h instanceof Headers ? (h.get(name) ?? "") : (h[name] ?? "");

/** Escapes text for an XML attribute or text node. Every value that reaches TwiML goes through this. */
export const xmlEscape = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** The TwiML that opens a two-way media stream and ends the call when the stream closes. */
export function streamTwiml(streamUrl: string, params: Record<string, string> = {}): string {
  if (!/^wss:\/\/[^\s?#]+$/.test(streamUrl))
    throw new PhoneProviderError("REFUSED", "The stream address must be wss:// with no query.");
  const parameters = Object.entries(params)
    // Twilio: the name and value of one parameter together stay under 500 characters.
    .filter(([k, v]) => k.length + v.length < 500)
    .map(([k, v]) => `<Parameter name="${xmlEscape(k)}" value="${xmlEscape(v)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xmlEscape(streamUrl)}">${parameters}</Stream></Connect><Hangup/></Response>`;
}
export const rejectTwiml = () =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>`;

/**
 * The signature Twilio puts in `X-Twilio-Signature`: base64 of HMAC-SHA1, keyed with the Auth Token, over the address Twilio called
 * followed by every form parameter sorted by name as name and value glued together. The algorithm is the one Twilio's helper libraries
 * implement; the security page does not spell the string out (docs/operations/phone.md).
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams | Record<string, string>,
): string {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const names = [...new Set(p.keys())].sort();
  let data = url;
  for (const n of names) for (const v of p.getAll(n).sort()) data += n + v;
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

const stripPort = (host: string) => host.toLowerCase().replace(/:443$/, "");

const TERMINAL = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

export function createTwilioProvider(o: TwilioOptions): PhoneProvider {
  const base = (o.baseUrl ?? TWILIO_API).replace(/\/$/, "");
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const account = `${base}/Accounts/${encodeURIComponent(o.accountSid)}`;
  const publicUrl = o.publicUrl.replace(/\/$/, "");
  const publicHost = stripPort(safeHost(publicUrl));
  const suffix = o.owner ? `/${encodeURIComponent(o.owner)}` : "";
  const voicePath = `${TWILIO_VOICE_PATH}${suffix}`;
  const statusPath = `${TWILIO_STATUS_PATH}${suffix}`;
  const voiceUrl = `${publicUrl}${voicePath}`;
  const statusUrl = `${publicUrl}${statusPath}`;
  const basic = `Basic ${Buffer.from(`${o.accountSid}:${o.authToken}`).toString("base64")}`;

  function safeHost(u: string) {
    try {
      return new URL(u).host;
    } catch {
      return "";
    }
  }

  async function call(
    method: string,
    path: string,
    form?: URLSearchParams,
    okStatuses: number[] = [],
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await doFetch(`${account}${path}`, {
        method,
        headers: {
          authorization: basic,
          accept: "application/json",
          ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: form?.toString(),
        signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
        redirect: "error",
      });
    } catch {
      throw new PhoneProviderError(
        "UNAVAILABLE",
        "The phone provider could not be reached. Try again in a moment.",
      );
    }
    if (okStatuses.includes(res.status)) return {};
    if (res.status === 401 || res.status === 403)
      throw new PhoneProviderError("AUTH", "The phone provider did not accept the saved key.");
    if (res.status === 404)
      throw new PhoneProviderError("NOT_FOUND", "The provider does not know that.");
    if (res.status === 429 || res.status >= 500)
      throw new PhoneProviderError(
        "UNAVAILABLE",
        "The phone provider is busy or down. Try again in a moment.",
      );
    if (!res.ok)
      throw new PhoneProviderError(
        "REFUSED",
        "The phone provider refused the request. Check the account (funds, the country's rules) and try again.",
      );
    const text = await res.text();
    if (!text) return {};
    try {
      return dig(JSON.parse(text));
    } catch {
      throw new PhoneProviderError(
        "BAD_ANSWER",
        "The phone provider sent an answer Zetta cannot read.",
      );
    }
  }

  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  const bad = () =>
    new PhoneProviderError("BAD_ANSWER", "The phone provider sent an answer Zetta cannot read.");

  /** The account's number with exactly these digits, or null. The filter matches loosely, so the digits are compared again. */
  async function lookup(e164: string): Promise<(HeldNumber & { voiceUrl: string }) | null> {
    let found: Record<string, unknown>;
    try {
      found = await call("GET", `/IncomingPhoneNumbers.json?${q({ PhoneNumber: e164 })}`);
    } catch (e) {
      if (e instanceof PhoneProviderError && e.code === "NOT_FOUND") return null;
      throw e;
    }
    for (const row of list(found.incoming_phone_numbers)) {
      const r = dig(row);
      if (str(r.phone_number) !== e164 || !str(r.sid)) continue;
      const voice = dig(r.capabilities).voice;
      return {
        providerRef: str(r.sid),
        connectionRef: str(r.voice_url) || null,
        // A number that cannot take voice calls is not ready to be a bot's line.
        status: voice === false ? "no_voice" : "active",
        voiceUrl: str(r.voice_url),
      };
    }
    return null;
  }

  // ---- the answer to an incoming call -----------------------------------------------------------------------------------------
  type Pending = {
    promise: Promise<string>;
    resolve: (xml: string) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  const pending = new Map<string, Pending>();
  function openReply(callSid: string) {
    if (pending.has(callSid)) return;
    let resolve!: (xml: string) => void;
    const promise = new Promise<string>((r) => (resolve = r));
    const timeout = o.replyTimeoutMs ?? TWILIO_REPLY_TIMEOUT_MS;
    const timer = setTimeout(() => {
      resolve(rejectTwiml());
      // Nobody came for it (a webhook refused before it was handled): forget it.
      setTimeout(() => pending.delete(callSid), 5_000).unref?.();
    }, timeout);
    timer.unref?.();
    pending.set(callSid, { promise, resolve, timer });
  }
  function settle(callSid: string, xml: string): boolean {
    const p = pending.get(callSid);
    if (!p) return false;
    clearTimeout(p.timer);
    p.resolve(xml);
    return true;
  }
  const streamOf = (c: CallControlOptions) => {
    if (!c.streamUrl)
      throw new PhoneProviderError("REFUSED", "A call needs a stream address to be answered.");
    return streamTwiml(c.streamUrl, c.streamParams);
  };
  /** Gives a call that is not waiting for a webhook answer new instructions. */
  const redirect = (id: string, twiml: string) =>
    call("POST", `/Calls/${encodeURIComponent(id)}.json`, new URLSearchParams({ Twiml: twiml }));

  return {
    name: "twilio",
    caps: {
      dtmf: "stream",
      answered: "stream",
      codec: "PCMU",
      streamToken: "parameter",
      streamSid: true,
    },

    async searchNumbers({ country, areaCode, limit = 5 }) {
      const params: Record<string, string> = {
        VoiceEnabled: "true",
        PageSize: String(Math.min(Math.max(limit, 1), 20)),
      };
      if (areaCode) params.AreaCode = areaCode;
      const out = await call(
        "GET",
        `/AvailablePhoneNumbers/${encodeURIComponent(country)}/Local.json?${q(params)}`,
      );
      return list(out.available_phone_numbers).flatMap((row): AvailableNumber[] => {
        const r = dig(row);
        const e164 = str(r.phone_number);
        if (!e164 || dig(r.capabilities).voice === false) return [];
        // The search carries no price (Twilio's page lists none): the cost is on Twilio's pricing page.
        return [{ e164, country, requirements: str(r.address_requirements) || undefined }];
      });
    },

    async orderNumber({ e164, reference, requirements }) {
      // Where Twilio says a number needs an address or a regulatory bundle (Brazil is one: companies only), the purchase cannot be made
      // here: a bundle is made and approved in the Twilio console, and the number is then attached.
      if (requirements && requirements !== "none")
        throw new PhoneProviderError(
          "REFUSED",
          "Twilio needs regulatory papers (a bundle and an address) for numbers there. Buy the number in the Twilio console with your company's bundle, then attach it here.",
        );
      const out = await call(
        "POST",
        "/IncomingPhoneNumbers.json",
        new URLSearchParams({
          PhoneNumber: e164,
          VoiceUrl: voiceUrl,
          VoiceMethod: "POST",
          StatusCallback: statusUrl,
          StatusCallbackMethod: "POST",
          FriendlyName: `Zetta ${reference}`.slice(0, 64),
        }),
      );
      const sid = str(out.sid);
      if (!sid) throw bad();
      return { providerRef: sid, e164, status: "active" };
    },

    async orderStatus(providerRef) {
      try {
        await call("GET", `/IncomingPhoneNumbers/${encodeURIComponent(providerRef)}.json`);
        return "active";
      } catch (e) {
        if (e instanceof PhoneProviderError && e.code === "NOT_FOUND") return "failed";
        throw e;
      }
    },

    async releaseNumber(e164) {
      const held = await lookup(e164);
      if (!held) return;
      await call(
        "DELETE",
        `/IncomingPhoneNumbers/${encodeURIComponent(held.providerRef)}.json`,
        undefined,
        [404],
      );
    },

    async findNumber(e164) {
      const held = await lookup(e164);
      return held
        ? { providerRef: held.providerRef, connectionRef: held.connectionRef, status: held.status }
        : null;
    },

    async routeNumber(e164) {
      const held = await lookup(e164);
      if (!held) throw new PhoneProviderError("NOT_FOUND", "The provider does not know that.");
      if (held.voiceUrl === voiceUrl) return;
      await call(
        "POST",
        `/IncomingPhoneNumbers/${encodeURIComponent(held.providerRef)}.json`,
        new URLSearchParams({
          VoiceUrl: voiceUrl,
          VoiceMethod: "POST",
          StatusCallback: statusUrl,
          StatusCallbackMethod: "POST",
        }),
      );
    },

    async placeCall(input: PlaceCall): Promise<PlacedCall> {
      const form = new URLSearchParams({
        To: input.to,
        From: input.from,
        Twiml: streamOf(input),
        StatusCallback: statusUrl,
        StatusCallbackMethod: "POST",
      });
      form.append("StatusCallbackEvent", "answered");
      form.append("StatusCallbackEvent", "completed");
      if (input.timeLimitSecs)
        form.set("TimeLimit", String(Math.max(30, Math.floor(input.timeLimitSecs))));
      if (input.detectMachine) {
        form.set("MachineDetection", "Enable");
        form.set("AsyncAmd", "true");
        form.set("AsyncAmdStatusCallback", statusUrl);
        form.set("AsyncAmdStatusCallbackMethod", "POST");
      }
      const out = await call("POST", "/Calls.json", form);
      const sid = str(out.sid);
      if (!sid) throw bad();
      return { callControlId: sid, callSessionId: sid };
    },

    async answer(id, c = {}) {
      const twiml = streamOf(c);
      if (!settle(id, twiml)) await redirect(id, twiml);
    },
    async reject(id) {
      if (settle(id, rejectTwiml())) return;
      await call(
        "POST",
        `/Calls/${encodeURIComponent(id)}.json`,
        new URLSearchParams({ Status: "completed" }),
      );
    },
    async hangup(id) {
      pending.delete(id);
      await call(
        "POST",
        `/Calls/${encodeURIComponent(id)}.json`,
        new URLSearchParams({ Status: "completed" }),
        [404],
      );
    },
    async startStream(id, c) {
      await redirect(id, streamOf(c));
    },

    verifyWebhook(rawBody, headers, ctx) {
      // Everything below fails closed: a missing token, header or field is a refusal, never a pass.
      if (!o.authToken || !publicHost) throw new WebhookError("NO_KEY");
      const path = ctx?.path;
      if (path !== voicePath && path !== statusPath) throw new WebhookError("MALFORMED");
      const given = header(headers, "x-twilio-signature");
      if (!given) throw new WebhookError("MALFORMED");
      // The address Twilio called must be the configured public address: a request that names another host is refused.
      const host = header(headers, "x-forwarded-host") || header(headers, "host");
      if (host && stripPort(host.split(",")[0]!.trim()) !== publicHost)
        throw new WebhookError("BAD_HOST");
      const params = new URLSearchParams(rawBody);
      const expected = Buffer.from(twilioSignature(o.authToken, `${publicUrl}${path}`, params));
      const got = Buffer.from(given);
      if (expected.length !== got.length || !timingSafeEqual(expected, got))
        throw new WebhookError("BAD_SIGNATURE");
      if (str(params.get("AccountSid")).toLowerCase() !== o.accountSid.toLowerCase())
        throw new WebhookError("BAD_ACCOUNT");
      const sid = params.get("CallSid") ?? "";
      if (!/^CA[0-9a-zA-Z]{8,64}$/.test(sid)) throw new WebhookError("MALFORMED");
      const payload: Record<string, unknown> = Object.fromEntries(params);
      const base = {
        occurredAt: new Date(now()).toISOString(),
        callControlId: sid,
        callSessionId: sid,
        from: params.get("From") || undefined,
        to: params.get("To") || undefined,
      };
      if (path === voicePath) {
        const incoming = params.get("Direction") === "inbound";
        // The call answers in the response of this very request: make room for the answer before the event is handled.
        openReply(sid);
        return {
          ...base,
          id: `tw:${sid}:voice`,
          type: incoming ? "call.initiated" : "call.voice.other",
          direction: incoming ? "incoming" : "outgoing",
          payload,
        } satisfies PhoneEvent;
      }
      const answeredBy = params.get("AnsweredBy");
      if (answeredBy) {
        const machine = answeredBy.startsWith("machine") || answeredBy === "fax";
        payload.result = machine ? "machine" : "human";
        return {
          ...base,
          id: `tw:${sid}:amd:${answeredBy}`,
          type: "call.machine.detection.ended",
          payload,
        } satisfies PhoneEvent;
      }
      const status = params.get("CallStatus") ?? "";
      if (!status) throw new WebhookError("MALFORMED");
      // Twilio's signature has no timestamp, so a repeat is told apart by the call, the status and the sequence number.
      const seq = (params.get("SequenceNumber") ?? "").slice(0, 10);
      return {
        ...base,
        id: `tw:${sid}:${status}:${seq}`.slice(0, 200),
        type:
          status === "in-progress"
            ? "call.answered"
            : TERMINAL.has(status)
              ? "call.hangup"
              : "call.status",
        payload,
      } satisfies PhoneEvent;
    },
    releaseEvent() {
      // Nothing is kept in memory: the database claim (replay.ts) is the record of what was seen.
    },
    async reply(ev) {
      const sid = ev.callControlId ?? "";
      const p = pending.get(sid);
      if (!p)
        return ev.type === "call.voice.other" || ev.type === "call.initiated"
          ? rejectTwiml()
          : undefined;
      const xml = await p.promise;
      pending.delete(sid);
      return xml;
    },

    async checkAccount(): Promise<AccountCheck> {
      let balance: string | undefined;
      try {
        const out = await call("GET", "/Balance.json");
        const amount = str(out.balance);
        balance = amount ? `${amount} ${str(out.currency)}`.trim() : undefined;
      } catch (e) {
        if (e instanceof PhoneProviderError && e.code === "AUTH")
          return { keyOk: false, applicationOk: false };
        throw e;
      }
      // There is no call application to look up: what has to work is the number resource, where each webhook address is set.
      try {
        await call("GET", `/IncomingPhoneNumbers.json?${q({ PageSize: "1" })}`);
        return { keyOk: true, applicationOk: true, balance };
      } catch (e) {
        if (e instanceof PhoneProviderError && (e.code === "AUTH" || e.code === "REFUSED"))
          return { keyOk: true, applicationOk: false, balance };
        throw e;
      }
    },
  };
}

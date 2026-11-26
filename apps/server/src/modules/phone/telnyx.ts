/**
 * Telnyx as the provider of bot phone numbers (https://developers.telnyx.com). Built from its public documentation; it has not been run
 * against a real Telnyx account (see docs/operations/phone.md).
 *
 *   search     GET    /available_phone_numbers?filter[country_code]&filter[national_destination_code]&filter[phone_number_type]=local&filter[limit]
 *   order      POST   /number_orders {phone_numbers:[{phone_number}], connection_id, customer_reference}   status pending | success | failure
 *   order      GET    /number_orders/{id}
 *   release    GET    /phone_numbers?filter[phone_number]=  then  DELETE /phone_numbers/{id}
 *   find       GET    /phone_numbers?filter[phone_number]=   (items: id, phone_number, connection_id, status)
 *   route      PATCH  /phone_numbers/{id} {connection_id}   (docs: api-reference/phone-number-configurations/update-a-phone-number)
 *   call       POST   /calls {connection_id, to, from, stream_url, stream_bidirectional_mode:"rtp", stream_bidirectional_codec, ...}
 *   actions    POST   /calls/{call_control_id}/actions/{answer|reject|hangup|streaming_start}
 *   account    GET    /balance, GET /call_control_applications/{id}
 *   webhooks   headers `telnyx-signature-ed25519` (base64) and `telnyx-timestamp` (unix seconds); Ed25519 over `<timestamp>|<raw body>`
 *              with the account's public key (base64, 32 raw bytes).
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  PhoneProviderError,
  WebhookError,
  type AccountCheck,
  type AvailableNumber,
  type CallControlOptions,
  type HeldNumber,
  type NumberOrder,
  type PhoneEvent,
  type PhoneProvider,
  type PlaceCall,
  type PlacedCall,
} from "./provider";

export const TELNYX_API = "https://api.telnyx.com/v2";
/** How far a webhook's timestamp may be from now, either way. Telnyx's own SDKs use five minutes. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
/** How long an event id is remembered as seen. */
const REPLAY_MEMORY_MS = 15 * 60_000;
const REPLAY_MEMORY_MAX = 10_000;

export type TelnyxOptions = {
  apiKey: string;
  /** The account's public key for webhook signatures: base64 of the 32 raw bytes (an SPKI DER in base64 or a PEM block also work). */
  publicKey: string;
  /** Id of the Call Control application the numbers and calls belong to. */
  connectionRef: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

const dig = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The DER prefix that turns 32 raw Ed25519 public key bytes into an SPKI key Node reads. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
/**
 * The public key as Telnyx shows it. Its docs do not say which form: the portal's base64 of the 32 raw bytes, an SPKI DER in base64 (44
 * bytes) or a PEM block. All three are accepted; anything else is refused (the check then fails closed with NO_KEY).
 */
export function ed25519PublicKey(text: string) {
  const body = text.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  const bytes = Buffer.from(body, "base64");
  let raw: Buffer | undefined;
  if (bytes.length === 32) raw = bytes;
  else if (
    bytes.length === SPKI_PREFIX.length + 32 &&
    bytes.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX)
  )
    raw = bytes.subarray(SPKI_PREFIX.length);
  if (!raw) return undefined;
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
  } catch {
    return undefined;
  }
}

const header = (h: Headers | Record<string, string | undefined>, name: string) =>
  h instanceof Headers ? (h.get(name) ?? "") : (h[name] ?? "");

export function createTelnyxProvider(o: TelnyxOptions): PhoneProvider {
  const base = (o.baseUrl ?? TELNYX_API).replace(/\/$/, "");
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const key = ed25519PublicKey(o.publicKey);
  /** Event ids already accepted, with when. In the memory of one process (a second instance would need the database; see the docs). */
  const seen = new Map<string, number>();

  async function call(
    method: string,
    path: string,
    body?: unknown,
    okStatuses: number[] = [],
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${o.apiKey}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
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

  const q = (params: Record<string, string>) =>
    Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

  const orderStatusOf = (v: unknown): NumberOrder["status"] =>
    v === "success" ? "active" : v === "failure" || v === "cancelled" ? "failed" : "pending_review";

  const media = (c: CallControlOptions) => ({
    ...(c.streamUrl
      ? {
          stream_url: c.streamUrl,
          stream_track: "inbound_track",
          stream_bidirectional_mode: "rtp",
          stream_bidirectional_codec: c.codec ?? "PCMU",
        }
      : {}),
    ...(c.clientState ? { client_state: Buffer.from(c.clientState).toString("base64") } : {}),
  });
  const action = (id: string, name: string, body: Record<string, unknown> = {}) =>
    call("POST", `/calls/${encodeURIComponent(id)}/actions/${name}`, body);

  function forget(at: number) {
    for (const [id, when] of seen) if (at - when > REPLAY_MEMORY_MS) seen.delete(id);
    // A flood cannot grow the memory without end: the oldest go first.
    while (seen.size > REPLAY_MEMORY_MAX) seen.delete(seen.keys().next().value as string);
  }

  /** The account's number with exactly these digits, or null. The filter matches loosely, so the digits are compared again. */
  async function lookup(e164: string): Promise<HeldNumber | null> {
    let found: Record<string, unknown>;
    try {
      found = await call("GET", `/phone_numbers?${q({ "filter[phone_number]": e164 })}`);
    } catch (e) {
      if (e instanceof PhoneProviderError && e.code === "NOT_FOUND") return null;
      throw e;
    }
    for (const row of list(found.data)) {
      const r = dig(row);
      if (str(r.phone_number) === e164 && str(r.id))
        return {
          providerRef: str(r.id),
          connectionRef: str(r.connection_id) || null,
          status: str(r.status) || "active",
        };
    }
    return null;
  }

  return {
    name: "telnyx",
    // Events are checked against the public key, so the key is the account. One that cannot be read verifies nothing.
    account: createHash("sha256")
      .update(key ? key.export({ format: "der", type: "spki" }) : `unreadable:${o.publicKey}`)
      .digest("hex"),
    caps: {
      dtmf: "webhook",
      answered: "webhook",
      // PCMU 8 kHz is the default Telnyx documents for the stream. L16 is listed too, but its byte order is not written anywhere, so a
      // real call could be noise. The code still follows whatever `start.media_format` says (`calls.ts`), so L16 can come back later.
      codec: "PCMU",
      streamToken: "query",
      streamSid: false,
    },

    async searchNumbers({ country, areaCode, limit = 5 }) {
      const params: Record<string, string> = {
        "filter[country_code]": country,
        "filter[phone_number_type]": "local",
        "filter[features][]": "voice",
        "filter[limit]": String(Math.min(Math.max(limit, 1), 20)),
      };
      if (areaCode) params["filter[national_destination_code]"] = areaCode;
      const out = await call("GET", `/available_phone_numbers?${q(params)}`);
      return list(out.data).flatMap((row): AvailableNumber[] => {
        const r = dig(row);
        const e164 = str(r.phone_number);
        if (!e164) return [];
        const cost = dig(r.cost_information);
        return [
          {
            e164,
            country,
            monthlyCost: str(cost.monthly_cost) || undefined,
            currency: str(cost.currency) || undefined,
          },
        ];
      });
    },

    async orderNumber({ e164, reference }) {
      const out = await call("POST", "/number_orders", {
        phone_numbers: [{ phone_number: e164 }],
        connection_id: o.connectionRef,
        customer_reference: reference.slice(0, 250),
      });
      const data = dig(out.data);
      const id = str(data.id);
      if (!id)
        throw new PhoneProviderError(
          "BAD_ANSWER",
          "The phone provider sent an answer Zetta cannot read.",
        );
      return { providerRef: id, e164, status: orderStatusOf(data.status) };
    },

    async orderStatus(providerRef) {
      const out = await call("GET", `/number_orders/${encodeURIComponent(providerRef)}`);
      return orderStatusOf(dig(out.data).status);
    },

    async releaseNumber(e164) {
      let found: Record<string, unknown>;
      try {
        found = await call("GET", `/phone_numbers?${q({ "filter[phone_number]": e164 })}`);
      } catch (e) {
        if (e instanceof PhoneProviderError && e.code === "NOT_FOUND") return;
        throw e;
      }
      const id = str(dig(list(found.data)[0]).id);
      if (!id) return;
      await call("DELETE", `/phone_numbers/${encodeURIComponent(id)}`, undefined, [404]);
    },

    async findNumber(e164) {
      return lookup(e164);
    },

    async routeNumber(e164) {
      const held = await lookup(e164);
      if (!held) throw new PhoneProviderError("NOT_FOUND", "The provider does not know that.");
      if (held.connectionRef === o.connectionRef) return;
      await call("PATCH", `/phone_numbers/${encodeURIComponent(held.providerRef)}`, {
        connection_id: o.connectionRef,
      });
    },

    async placeCall(input: PlaceCall): Promise<PlacedCall> {
      const out = await call("POST", "/calls", {
        connection_id: o.connectionRef,
        to: input.to,
        from: input.from,
        ...media(input),
        ...(input.timeLimitSecs
          ? { time_limit_secs: Math.max(30, Math.floor(input.timeLimitSecs)) }
          : {}),
        ...(input.detectMachine ? { answering_machine_detection: "detect" } : {}),
      });
      const data = dig(out.data);
      const callControlId = str(data.call_control_id);
      if (!callControlId)
        throw new PhoneProviderError(
          "BAD_ANSWER",
          "The phone provider sent an answer Zetta cannot read.",
        );
      return { callControlId, callSessionId: str(data.call_session_id) };
    },

    async answer(id, c = {}) {
      await action(id, "answer", media(c));
    },
    async reject(id) {
      await action(id, "reject", { cause: "USER_BUSY" });
    },
    async hangup(id) {
      await action(id, "hangup");
    },
    async startStream(id, c) {
      await action(id, "streaming_start", media(c));
    },

    verifyWebhook(rawBody, headers) {
      // Everything below fails closed: a missing key, header or field is a refusal, never a pass.
      if (!key) throw new WebhookError("NO_KEY");
      const signature = Buffer.from(header(headers, "telnyx-signature-ed25519"), "base64");
      const stamp = header(headers, "telnyx-timestamp");
      if (signature.length !== 64 || !/^\d{9,12}$/.test(stamp)) throw new WebhookError("MALFORMED");
      let good = false;
      try {
        good = verify(null, Buffer.from(`${stamp}|${rawBody}`, "utf8"), key, signature);
      } catch {
        good = false;
      }
      if (!good) throw new WebhookError("BAD_SIGNATURE");
      const at = now();
      if (Math.abs(at / 1000 - Number(stamp)) > WEBHOOK_TOLERANCE_SECONDS)
        throw new WebhookError("STALE");
      let parsed: Record<string, unknown>;
      try {
        parsed = dig(JSON.parse(rawBody));
      } catch {
        throw new WebhookError("MALFORMED");
      }
      const data = dig(parsed.data);
      const id = str(data.id);
      const type = str(data.event_type);
      if (!id || !type) throw new WebhookError("MALFORMED");
      forget(at);
      if (seen.has(id)) throw new WebhookError("REPLAYED");
      seen.set(id, at);
      const p = dig(data.payload);
      let clientState: string | undefined;
      if (typeof p.client_state === "string" && p.client_state)
        clientState = Buffer.from(p.client_state, "base64").toString("utf8");
      return {
        id,
        type,
        occurredAt: str(data.occurred_at),
        callControlId: str(p.call_control_id) || undefined,
        callSessionId: str(p.call_session_id) || undefined,
        from: str(p.from) || undefined,
        to: str(p.to) || undefined,
        direction: str(p.direction) || undefined,
        clientState,
        payload: p,
      } satisfies PhoneEvent;
    },
    releaseEvent(id) {
      seen.delete(id);
    },

    async checkAccount(): Promise<AccountCheck> {
      let balance: string | undefined;
      try {
        const out = dig((await call("GET", "/balance")).data);
        const amount = str(out.available_credit) || str(out.balance);
        balance = amount ? `${amount} ${str(out.currency)}`.trim() : undefined;
      } catch (e) {
        if (e instanceof PhoneProviderError && e.code === "AUTH")
          return { keyOk: false, applicationOk: false };
        throw e;
      }
      try {
        await call("GET", `/call_control_applications/${encodeURIComponent(o.connectionRef)}`);
        return { keyOk: true, applicationOk: true, balance };
      } catch (e) {
        if (e instanceof PhoneProviderError && (e.code === "NOT_FOUND" || e.code === "REFUSED"))
          return { keyOk: true, applicationOk: false, balance };
        throw e;
      }
    },
  };
}

/**
 * What the telephony service behind bot phone numbers must do, whatever it is. `telnyx.ts` and `twilio.ts` implement it; `fake.ts` and
 * `fake-twilio.ts` serve the tests with a fake HTTP server and a webhook signer for each. The state machine of a call (`calls.ts`) knows
 * only this type and the `caps` of a provider, never a provider's name.
 *
 * Every failure is a `PhoneProviderError`: a stable code and a sentence a person can read, never the provider's own words. The API key
 * is sent in one header and nowhere else.
 */

export type PhoneErrorCode =
  | "AUTH" // the provider refused the key
  | "NOT_FOUND"
  | "UNAVAILABLE" // network, timeout or a provider outage
  | "REFUSED" // the provider refused the request (no such number, no funds, a rule of the country)
  | "BAD_ANSWER";

export class PhoneProviderError extends Error {
  constructor(
    readonly code: PhoneErrorCode,
    /** A sentence for the person; never the provider's words. */
    readonly safe: string,
  ) {
    super(code);
    this.name = "PhoneProviderError";
  }
}

/** Why a webhook was not accepted. Every one of them is a refusal: nothing is processed. */
export class WebhookError extends Error {
  constructor(
    readonly code:
      | "NO_KEY"
      | "MALFORMED"
      | "BAD_SIGNATURE"
      | "STALE"
      | "REPLAYED"
      | "BAD_HOST"
      | "BAD_ACCOUNT",
  ) {
    super(code);
    this.name = "WebhookError";
  }
}

export type AvailableNumber = {
  e164: string;
  country: string;
  /** Monthly cost in the provider's currency, when it says. */
  monthlyCost?: string;
  currency?: string;
  /**
   * What the provider says a number there needs besides money (Twilio: `address_requirements`: `none`, `any`, `local`, `foreign`). Anything
   * but `none` means papers (an address, a regulatory bundle) the provider checks before the number is yours.
   */
  requirements?: string;
};

export type NumberOrder = {
  /** The provider's id of the order. */
  providerRef: string;
  e164: string;
  /**
   * `active`: ready to use. `pending_review`: the order is placed and the regulator or carrier is still reviewing the papers.
   * `failed`: the provider refused it.
   */
  status: "active" | "pending_review" | "failed";
};

/** A number the provider's account holds, as the provider says it stands now. */
export type HeldNumber = {
  /** The provider's id of the number. */
  providerRef: string;
  /** The call application or connection it routes to now, or null when none. */
  connectionRef: string | null;
  /** The provider's own state word ("active"...), for a decision, never shown. */
  status: string;
};

export type AudioCodec = "PCMU" | "L16";

/** The ids of the providers (`@zetta/core/phone`). */
export type PhoneProviderId = "telnyx" | "twilio";

/** How a provider differs from another where the call state machine must care. Read from the provider, never from its name. */
export type ProviderCaps = {
  /** Where the keys a caller presses come from: the provider's webhook (Telnyx) or the media stream's own messages (Twilio). */
  dtmf: "webhook" | "stream";
  /** What tells that the called party picked up: a `call.answered` event (Telnyx), or the media stream opening (Twilio). */
  answered: "webhook" | "stream";
  /** The audio codec of the stream, and the only one the provider offers or the one asked for. */
  codec: AudioCodec;
  /** Where the one-time stream token travels: the address's query (Telnyx), or a custom parameter of the stream (Twilio: no query). */
  streamToken: "query" | "parameter";
  /** Whether messages sent on the media socket carry the `streamSid` of the stream (Twilio). */
  streamSid: boolean;
};

export type CallControlOptions = {
  /** `wss://` address the provider connects to with the call's audio. */
  streamUrl?: string;
  /** Audio both ways: `PCMU` (8 kHz mu-law) or `L16` (16 kHz 16-bit linear, network byte order). Default `PCMU`. */
  codec?: AudioCodec;
  /** Returned unchanged in every webhook of the call. */
  clientState?: string;
  /** Custom parameters of the stream (Twilio): they arrive in the stream's `start` message. The token travels here, as no query is allowed. */
  streamParams?: Record<string, string>;
};

export type PlaceCall = CallControlOptions & {
  to: string;
  from: string;
  /** The call hangs up by itself after this many seconds (30 at least). */
  timeLimitSecs?: number;
  /** Ask the provider to tell a person from an answering machine. */
  detectMachine?: boolean;
};

export type PlacedCall = { callControlId: string; callSessionId: string };

/** An event the provider sent, after its signature was checked. */
export type PhoneEvent = {
  id: string;
  type: string;
  occurredAt: string;
  callControlId?: string;
  callSessionId?: string;
  from?: string;
  to?: string;
  direction?: string;
  /** The `clientState` of the call, decoded. */
  clientState?: string;
  payload: Record<string, unknown>;
};

export type AccountCheck = {
  /** The key is accepted. */
  keyOk: boolean;
  /** The call application the numbers are attached to exists. */
  applicationOk: boolean;
  /** What the provider says the account holds, as text ("12.50 USD"), when it says. */
  balance?: string;
};

export type PhoneProvider = {
  readonly name: PhoneProviderId;
  readonly caps: ProviderCaps;
  searchNumbers(q: {
    country: string;
    areaCode?: string;
    limit?: number;
  }): Promise<AvailableNumber[]>;
  /** Buys one number that a search returned, and attaches it to the installation's call application. */
  orderNumber(input: {
    e164: string;
    reference: string;
    /** The `requirements` the search showed for this number. */
    requirements?: string;
  }): Promise<NumberOrder>;
  /** Where an order stands now (a Brazilian order can take days). */
  orderStatus(providerRef: string): Promise<NumberOrder["status"]>;
  /** Gives the number back. A number the provider no longer holds is not an error. */
  releaseNumber(e164: string): Promise<void>;
  /** Whether the account holds this number (one bought elsewhere, for example in the provider's dashboard), or null when it does not. */
  findNumber(e164: string): Promise<HeldNumber | null>;
  /** Points a number the account holds at the installation's call application (the same `connectionRef` an order uses). */
  routeNumber(e164: string): Promise<void>;
  placeCall(input: PlaceCall): Promise<PlacedCall>;
  answer(callControlId: string, o?: CallControlOptions): Promise<void>;
  /** Refuses a call that rings, with busy. */
  reject(callControlId: string): Promise<void>;
  hangup(callControlId: string): Promise<void>;
  startStream(callControlId: string, o: CallControlOptions): Promise<void>;
  /**
   * Checks the signature and the age of a webhook and claims its id. The body must be the exact bytes received. Throws `WebhookError`
   * for anything that is not good, so a caller fails closed. A claimed id is refused when it comes again (a replay) until
   * `releaseEvent` is called, which a handler does when it failed and wants the provider's retry.
   */
  verifyWebhook(
    rawBody: string,
    headers: Headers | Record<string, string | undefined>,
    /** The path the provider called (Twilio signs the full address it called, so the path is part of what is checked). */
    ctx?: { path?: string },
  ): PhoneEvent;
  releaseEvent(id: string): void;
  /**
   * What the webhook's HTTP answer must carry for this event, when the provider answers a call in the response (Twilio's TwiML). Called
   * after the event was handled; waits for `answer` or `reject` of the call, and falls back to a refusal. Undefined: nothing to send.
   */
  reply?(ev: PhoneEvent): Promise<string | undefined>;
  /** Whether the key and the call application work: for the settings card's Test button. */
  checkAccount(): Promise<AccountCheck>;
};

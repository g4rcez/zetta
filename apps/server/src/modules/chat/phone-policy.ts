/**
 * When a bot's outgoing phone call is placed at once, when it waits for the person, and when it is refused. Pure: the chat service and the
 * phone service gather the facts, and nothing here is a rule written in a prompt for the model to obey. A call costs money and reaches a
 * real person, so the server decides (same shape as mail-policy.ts, which this reuses for the turn's facts).
 *
 * The rule: the person's own request in this turn is the approval. A call goes out without a card only when ALL of these hold:
 *   a. the turn is the person's own message in their own chat with the bot (`place` "chat": never a loop, a routine or a turn Zetta started);
 *   b. the person's own words in this turn ask for a call (`asksToCall`, on their message only, never on a page, a mail or a tool result);
 *   c. the number is one the person wrote in that message, or the owner's own registered number;
 *   d. the turn read no outside content before the call (`readElsewhere`).
 * Every other allowed case is a card (the number, the country, the briefing, the longest the call may take, one Approve click). There is no
 * "always allow" for a call (a paused plugin call is never remembered: approval-rules.ts).
 *
 * `phoneBlock` is separate and runs first, whoever asked and whatever a card says: emergency numbers, numbers that are not E.164, another bot's
 * number of this installation (a call loop), numbers on the do-not-call list, premium-rate and shared-cost destinations, countries the
 * operator did not allow, and the operator's daily limits. They are in code and not configurable.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { isE164 } from "@zetta/core/phone";
import type { PluginTurn } from "../integrations/plugins/turn";
import type { MailTurnFacts } from "./mail-policy";

export type PhoneCallMode = "call" | "card" | "refuse";

/** Why a call is not placed, as a closed code. The tool turns each into a sentence for the bot and the person. */
export type PhoneRefusal =
  | "not_here"
  | "no_number"
  | "not_active"
  | "outbound_off"
  | "no_provider"
  | "turn_limit"
  | "busy"
  | "emergency"
  | "invalid_number"
  | "own_bot_number"
  | "opted_out"
  | "premium_rate"
  | "country_not_allowed"
  | "daily_calls"
  | "daily_minutes"
  | "outside_hours";

/** The facts of a turn: the mail gate's (where it runs, the person's words, whether it read elsewhere) and the calls of this turn. */
export type PhoneTurnFacts = Pick<MailTurnFacts, "place" | "personText" | "readElsewhere"> & {
  /** Calls and cards already made this turn (the chat service's turn record has none until the first). */
  phoneAttempts?: number;
};

/** What the service knows about this one call. */
export type PhoneCallFacts = {
  /** The bot's own number: its row, as the server read it. */
  number: { status: string; outbound: string } | undefined;
  provider: "ready" | "off";
  /** The bot is on another call now. */
  busy: boolean;
  /** The owner's own phone as registered on the number (E.164). */
  ownerNumber: string | null;
  /** The number the bot asked to call, as the bot wrote it. */
  to: string;
  block: PhoneBlock;
};

export type PhoneDecision = { mode: PhoneCallMode; reason?: PhoneRefusal | undefined };

export const PHONE_TURN_LIMIT = 2;
/** What the tool accepts. The briefing is spoken about, never run: the cap keeps a card readable. */
export const PHONE_CALL_LIMITS = { briefing: 1500, defaultMinutes: 5 } as const;

/* ---------------------------------------------------------------------------------------------------------------------------------
 * Hard blocks.
 * ------------------------------------------------------------------------------------------------------------------------------- */

/** Emergency and crisis numbers by country, as dialed inside the country. Calling one is never a bot's job, whoever asks. */
const EMERGENCY: Record<string, readonly string[]> = {
  BR: ["100", "180", "188", "190", "191", "192", "193", "194", "197", "198", "199"],
  US: ["911", "988"],
  CA: ["911", "988"],
  GB: ["999", "112"],
  PT: ["112"],
  ES: ["112", "061", "062", "091", "092"],
  DE: ["110", "112"],
  FR: ["15", "17", "18", "112", "115"],
  IT: ["112", "113", "115", "118"],
  AR: ["911", "100", "101", "107"],
  MX: ["911", "060", "065", "066"],
  CL: ["131", "132", "133"],
  CO: ["123", "112"],
  UY: ["911", "104", "105", "107"],
  AU: ["000", "112"],
  NZ: ["111"],
  IN: ["100", "101", "102", "108", "112"],
  JP: ["110", "118", "119"],
};
/** Calling code to country, for the countries above (a number dialed as +<code><emergency number>). */
const CALLING_CODE: Record<string, string> = {
  "55": "BR",
  "1": "US",
  "44": "GB",
  "351": "PT",
  "34": "ES",
  "49": "DE",
  "33": "FR",
  "39": "IT",
  "54": "AR",
  "52": "MX",
  "56": "CL",
  "57": "CO",
  "598": "UY",
  "61": "AU",
  "64": "NZ",
  "91": "IN",
  "81": "JP",
};
/** Numbers that are an emergency line in so many countries that no destination may be dialed as them. */
const EMERGENCY_EVERYWHERE = ["112", "911", "999", "000", "110", "119", "190", "192", "193", "199"];

/** Whether what was typed is an emergency number (bare, with a +, or after a country calling code). Digits only are compared. */
export function isEmergencyNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, "").replace(/^00(?=\d{4,})/, "");
  if (!digits) return false;
  if (EMERGENCY_EVERYWHERE.includes(digits)) return true;
  for (const [code, country] of Object.entries(CALLING_CODE)) {
    if (!digits.startsWith(code)) continue;
    const after = digits.slice(code.length);
    // The same digits with one national trunk zero in front ("+55 0190") are the same number.
    for (const rest of [after, after.replace(/^0(?=\d)/, "")])
      if (EMERGENCY[country]?.includes(rest) || EMERGENCY_EVERYWHERE.includes(rest)) return true;
  }
  return false;
}

export type PhoneBlock = {
  /** The number as E.164 when it is one. */
  e164: string | undefined;
  /** Its country (ISO), when the number is valid. */
  country: string | undefined;
  /** What libphonenumber says it is (MOBILE, PREMIUM_RATE...). */
  type: string | undefined;
  reason: PhoneRefusal | undefined;
};

/** What the operator set (installation settings) and what the bot used today. */
export type PhoneLimits = {
  /** Upper case ISO codes. Empty means no destination is allowed. */
  countries: readonly string[];
  maxCallMinutes: number;
  dailyMinutesPerBot: number;
  dailyCallsPerBot: number;
};
export type PhoneUsed = { calls: number; seconds: number };

export type BlockInput = {
  /** The number as the bot gave it. */
  to: string;
  /** Every number the installation holds for its bots (E.164): calling one is a call loop. */
  botNumbers: ReadonlySet<string>;
  /** On the do-not-call list. */
  optedOut: boolean;
  limits: PhoneLimits;
  used: PhoneUsed;
};

/** The destination rules that hold for every call. Returns the first that applies, or `reason: undefined`. */
export function phoneBlock(i: BlockInput): PhoneBlock {
  const typed = i.to.trim();
  const none: PhoneBlock = {
    e164: undefined,
    country: undefined,
    type: undefined,
    reason: undefined,
  };
  if (isEmergencyNumber(typed)) return { ...none, reason: "emergency" };
  const compact = typed.replace(/[\s().-]/g, "");
  if (!isE164(compact)) return { ...none, reason: "invalid_number" };
  const parsed = parsePhoneNumberFromString(compact);
  if (!parsed?.isValid()) return { ...none, e164: compact, reason: "invalid_number" };
  const e164 = parsed.number;
  const country = parsed.country;
  const type = parsed.getType();
  const base = { e164, country, type } as const;
  if (country && EMERGENCY[country]?.includes(parsed.nationalNumber))
    return { ...base, reason: "emergency" };
  if (i.botNumbers.has(e164)) return { ...base, reason: "own_bot_number" };
  if (i.optedOut) return { ...base, reason: "opted_out" };
  if (type === "PREMIUM_RATE" || type === "SHARED_COST") return { ...base, reason: "premium_rate" };
  if (!country || !i.limits.countries.includes(country))
    return { ...base, reason: "country_not_allowed" };
  if (i.used.calls >= i.limits.dailyCallsPerBot) return { ...base, reason: "daily_calls" };
  if (i.used.seconds >= i.limits.dailyMinutesPerBot * 60)
    return { ...base, reason: "daily_minutes" };
  return { ...base, reason: undefined };
}

/** The longest this call may take: what was asked, the operator's cap per call, and what is left of the day. At least one minute. */
export function callMinutes(asked: number | undefined, l: PhoneLimits, used: PhoneUsed): number {
  const wanted =
    Number.isFinite(asked) && asked! >= 1 ? Math.floor(asked!) : PHONE_CALL_LIMITS.defaultMinutes;
  const left = Math.floor((l.dailyMinutesPerBot * 60 - used.seconds) / 60);
  return Math.max(1, Math.min(wanted, l.maxCallMinutes, left));
}

/* ---------------------------------------------------------------------------------------------------------------------------------
 * Calling hours: 08:00 to 20:00 where the person called lives.
 * ------------------------------------------------------------------------------------------------------------------------------- */

export const CALLING_HOURS = { from: 8, to: 20 } as const;

/** Time zones of a country. A country with several is allowed only when it is inside the hours in all of them (the careful side). */
const ZONES: Record<string, readonly string[]> = {
  US: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
  CA: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver"],
  GB: ["Europe/London"],
  PT: ["Europe/Lisbon"],
  ES: ["Europe/Madrid"],
  DE: ["Europe/Berlin"],
  FR: ["Europe/Paris"],
  IT: ["Europe/Rome"],
  NL: ["Europe/Amsterdam"],
  IE: ["Europe/Dublin"],
  AR: ["America/Argentina/Buenos_Aires"],
  CL: ["America/Santiago"],
  CO: ["America/Bogota"],
  PE: ["America/Lima"],
  UY: ["America/Montevideo"],
  MX: ["America/Mexico_City"],
  AU: ["Australia/Sydney", "Australia/Perth"],
  NZ: ["Pacific/Auckland"],
  IN: ["Asia/Kolkata"],
  JP: ["Asia/Tokyo"],
};
/** Brazil by area code: most of the country is Brasilia time; these states are not. */
const BR_AREA_ZONE: Record<string, string> = {
  "68": "America/Rio_Branco",
  "92": "America/Manaus",
  "97": "America/Manaus",
  "95": "America/Boa_Vista",
  "69": "America/Porto_Velho",
  "65": "America/Cuiaba",
  "66": "America/Cuiaba",
  "67": "America/Campo_Grande",
};

/** The zones the number's local time is read in, or undefined when the country is not known (then the hours cannot be checked). */
export function zonesOf(e164: string): readonly string[] | undefined {
  const parsed = parsePhoneNumberFromString(e164);
  const country = parsed?.country;
  if (!parsed || !country) return undefined;
  if (country === "BR")
    return [BR_AREA_ZONE[parsed.nationalNumber.slice(0, 2)] ?? "America/Sao_Paulo"];
  return ZONES[country];
}

const hourIn = (zone: string, at: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return h + m / 60;
};

/** Whether it is between 08:00 and 20:00 at the destination (in every zone of it) at `at`. An unknown destination is not. */
export function inCallingHours(e164: string, at: Date): boolean {
  const zones = zonesOf(e164);
  if (!zones?.length) return false;
  return zones.every((z) => {
    const h = hourIn(z, at);
    return h >= CALLING_HOURS.from && h < CALLING_HOURS.to;
  });
}

/* ---------------------------------------------------------------------------------------------------------------------------------
 * The decision.
 * ------------------------------------------------------------------------------------------------------------------------------- */

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Whether the number is written in the person's words (whole, as E.164 or with the usual separators; never inside a longer number). */
export function numberNamedIn(text: string, e164: string): boolean {
  if (!e164) return false;
  const want = digitsOf(e164);
  for (const m of text.matchAll(/(?<![\d+])(\+|00)?\d[\d\s().-]{4,}\d(?!\d)/g)) {
    const found = digitsOf(m[0]).replace(/^00/, "");
    if (found === want && (m[1] || found.length === want.length)) return true;
  }
  return false;
}

/** Where a call may go at all: the places the person's own turn, a loop or Zetta's own turn runs. */
const PLACES: readonly (PluginTurn | undefined)[] = ["chat", "loop", "server"];

/** The reasons a call must not run at all, from the cheap facts. The tool asks before it reads anything else. */
export function phoneRefusal(
  t: Pick<PhoneTurnFacts, "place" | "phoneAttempts">,
  c: PhoneCallFacts,
) {
  if (!PLACES.includes(t.place)) return "not_here" as const;
  if (!c.number) return "no_number" as const;
  if (c.number.status !== "active") return "not_active" as const;
  if (c.number.outbound !== "on") return "outbound_off" as const;
  if (c.provider !== "ready") return "no_provider" as const;
  if ((t.phoneAttempts ?? 0) >= PHONE_TURN_LIMIT) return "turn_limit" as const;
  if (c.busy) return "busy" as const;
  return c.block.reason;
}

/** Does the person's own message ask for this call? True when the person asked for a call and pointed at the number (point c). */
export function phoneCallAsked(t: PhoneTurnFacts, c: PhoneCallFacts): boolean {
  if (t.place !== "chat" || t.readElsewhere) return false;
  if (!asksToCall(t.personText)) return false;
  const e164 = c.block.e164;
  if (!e164) return false;
  return (c.ownerNumber !== null && c.ownerNumber === e164) || numberNamedIn(t.personText, e164);
}

/**
 * `call`, `card` or `refuse`. `now` is for the calling hours: a call the person did not ask for directly is refused outside them (a card
 * for a call at night would only move the decision to a moment nobody is watching). A call to the owner's own number is never held to them.
 */
export function phoneCallMode(t: PhoneTurnFacts, c: PhoneCallFacts, now: Date): PhoneDecision {
  const reason = phoneRefusal(t, c);
  if (reason) return { mode: "refuse", reason };
  if (phoneCallAsked(t, c)) return { mode: "call" };
  const e164 = c.block.e164!;
  const toOwner = c.ownerNumber !== null && c.ownerNumber === e164;
  const askedNow = t.place === "chat" && asksToCall(t.personText);
  if (!toOwner && !askedNow && !inCallingHours(e164, now))
    return { mode: "refuse", reason: "outside_hours" };
  return { mode: "card" };
}

/** What the tool is handed by the chat service. The turn facts stay on the server side of this object. */
export type PhoneGate = {
  decide(c: PhoneCallFacts, now?: Date): PhoneDecision;
  /** Early check: the reason a call must not run at all, or undefined. Counts nothing. */
  refusal(c: PhoneCallFacts): PhoneRefusal | undefined;
  /** A call or a card was made: it counts against the per-turn limit. */
  record(): void;
};

/** The gate over the facts of one turn. `t` is the turn's own record: `record` and the readers of `readElsewhere` change it in place. */
export const phoneGateFor = (t: PhoneTurnFacts): PhoneGate => ({
  decide: (c, now = new Date()) => phoneCallMode(t, c, now),
  refusal: (c) => phoneRefusal(t, c),
  record: () => void (t.phoneAttempts = (t.phoneAttempts ?? 0) + 1),
});

/** A gate for a call with no turn information (a test, a direct call): it never places a call without a card. */
export const phoneCardOnlyGate = (place: PluginTurn | undefined): PhoneGate =>
  phoneGateFor({ place, personText: "", readElsewhere: true, phoneAttempts: 0 });

/* ---------------------------------------------------------------------------------------------------------------------------------
 * Did the person ask for a call? English, Portuguese and Spanish. Deliberately wide in what it reads as a command and strict in what it lets
 * through: a miss is a card (one click), a false hit would let a bot phone someone in their name. It reads the person's own message only. A
 * question about calls ("did he call?", "should I call?"), a draft, a refusal ("don't call") and a call that is only talked about are not
 * requests.
 * ------------------------------------------------------------------------------------------------------------------------------- */

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");

const FILLER =
  "(?:(?:please|pls|plz|kindly|now|then|ok|okay|also|and|just|so|go ahead and|por favor|pf|porfa|agora|entao|depois|e|tambem|vai|ahora|luego|despues|y|tambien|pues)\\b[ ,]*)*";
/** Verbs that place a call, imperative or infinitive. A noun use ("call from Ana", "call history") is not a command. */
const VERB =
  "(?:call|phone|ring|dial|give \\w+ a (?:call|ring|buzz)|give a (?:call|ring)|make (?:a )?(?:phone )?call|place (?:a )?(?:phone )?call|" +
  "lig(?:ue|ar|a)(?:-me)?|telefon(?:e|a|ar)(?= (?:para|pra|ao|a|a o|ate)\\b)|(?:faca|faz|fazer) (?:uma )?ligacao|d(?:a|ar|e) uma ligada|" +
  "llam(?:a|as|e|es|ar)(?:me|le|nos)?|telefon(?:ea|ee|ear)|marc(?:a|ar)(?= (?:al|el|a|\\+|\\d))|(?:haz|hacer|realiza|realizar) (?:una )?llamada)" +
  "(?!\\s+(?:from|is|was|has|had|came|will|would|should|can|log|history|record|de ontem|ontem|anterior|ayer|anterior)\\b)";
const COMMAND = new RegExp(`^${FILLER}${VERB}\\b`);
const POLITE = new RegExp(
  `\\b(?:(?:can|could|would|will) you|(?:i(?:'d| would)? (?:want|need|like)|i'd like) you to|` +
    `pode|poderia|consegue|voce pode|quero que|preciso que|` +
    `puedes|podrias|puede|quiero que|necesito que)(?: voce| please| por favor)*[ ,]*${VERB}\\b`,
);
const NOT_NOW =
  /\b(draft|drafts|rascunho|rascunhos|borrador|borradores|script|roteiro|guion|preview|propose|suggest|suggestion|sugira|sugere|sugiro|sugiere|proponha|propon|do not|don't|dont|never|nao|nunca|no lo|no me|no llam\w*|sin|sem|without|wait|hold|espera|aguarde|aguardar|until|before|antes|hasta que|ate eu|ate que|unless|a menos|se eu|if i)\b/;
const CONTENT =
  /\b(?:that|saying|say|says|telling|dizendo|diciendo|about|sobre|acerca)\b|(?<!quero )(?<!preciso )(?<!quiero )(?<!necesito )\bque\b|["“:]/;
const QUESTION_START =
  /^(?:what|how|should|did|do|does|is|are|was|were|why|when|who|which|can i|could i|que|como|devo|deveria|precisa|qual|quem|quando|por que|porque|cual|quien|cuando|debo|deberia|donde)\b/;
/** "ask Ana to call me", "tell him to ring": somebody else is told to call, nobody is called. */
const CLAUSE_SPLIT = /\s*(?:[;,]|\b(?:and then|and|then|e depois|depois|y luego|luego)\b)\s*/;

export function asksToCall(personText: string): boolean {
  for (const raw of strip(personText).split(/(?<=[.!?\n])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const question = sentence.endsWith("?");
    const head = sentence.split(CONTENT)[0] ?? sentence;
    if (NOT_NOW.test(head)) continue;
    if (POLITE.test(head) && !QUESTION_START.test(sentence)) return true;
    if (question) continue;
    for (const clause of sentence.split(CLAUSE_SPLIT)) if (COMMAND.test(clause.trim())) return true;
  }
  return false;
}

/**
 * What happens to an incoming call, decided from facts and nothing else (so it is tested without a phone, a database or a clock), and the
 * keypad PIN collector. Caller ID is never a credential: matching the owner's number only means "ask for the PIN".
 */
import { PIN_LENGTH, type PhoneInboundMode, type PhoneNumberStatus } from "@zetta/core/phone";

/** Limits that are not installation settings. */
export const PHONE_CALL_LIMITS = {
  /** A call from anyone but the owner ends after this long. */
  outsideMaxMs: 5 * 60_000,
  /** A call ends after this long with nobody speaking and the bot idle. */
  silenceMs: 20_000,
  /** How long the owner has to start typing the PIN. */
  pinStartMs: 15_000,
  /** Words the bot may take a message with, cut at this many characters. */
  messageChars: 1000,
  /** Refused (answered with a fixed sentence) calls an hour per number; past it the call is rejected without being answered. */
  refusedPerHour: 30,
  /** Wrong PINs in one call before it hangs up (the number locks at the same count, see core/phone). */
  pinTries: 3,
} as const;

export type ClosedSentence = "notInService" | "busy" | "ownerOnly" | "limit";

export type StartFacts = {
  numberStatus: PhoneNumberStatus;
  inbound: PhoneInboundMode;
  /** The caller's number as E.164, or null when withheld. */
  from: string | null;
  ownerNumber: string | null;
  pinSet: boolean;
  pinLocked: boolean;
  /** The bot is on another call. */
  busy: boolean;
  /** The bot reached its calls or minutes of the day. */
  overLimit: boolean;
};

export type StartPlan =
  /** Answer, say the opening sentence and one fixed sentence, hang up. */
  | { kind: "closed"; sentence: ClosedSentence }
  /** Ask for the PIN. `owner_only`: a caller who does not pass is sent away; `anyone`: they continue as an outside person. */
  | { kind: "pin"; inbound: "owner_only" | "anyone" }
  | { kind: "outside" };

export function decideStart(f: StartFacts): StartPlan {
  if (f.numberStatus !== "active" || f.inbound === "off")
    return { kind: "closed", sentence: "notInService" };
  if (f.busy) return { kind: "closed", sentence: "busy" };
  // The owner's number plus a PIN that can still be tried: the only way to be taken for the owner.
  const candidate = f.from !== null && f.from === f.ownerNumber && f.pinSet && !f.pinLocked;
  if (f.inbound === "owner_only")
    return candidate
      ? { kind: "pin", inbound: "owner_only" }
      : { kind: "closed", sentence: "ownerOnly" };
  // The owner is never kept out by the day's quota, which an attacker could use up; if they do not pass the PIN they are checked again.
  if (candidate) return { kind: "pin", inbound: "anyone" };
  return f.overLimit ? { kind: "closed", sentence: "limit" } : { kind: "outside" };
}

export type PinInput = { kind: "none" } | { kind: "submit"; pin: string };

/**
 * Digits typed on the keypad. `#` sends what was typed, `*` clears it, and so does the longest PIN. Only the digits go on; the PIN is
 * kept in memory for the length of the entry and never written anywhere.
 */
export function createPinCollector() {
  let digits = "";
  return {
    push(key: string): PinInput {
      if (key === "*") {
        digits = "";
        return { kind: "none" };
      }
      if (key === "#") {
        const pin = digits;
        digits = "";
        return { kind: "submit", pin };
      }
      if (!/^[0-9]$/.test(key)) return { kind: "none" };
      digits += key;
      if (digits.length >= PIN_LENGTH.max) {
        const pin = digits;
        digits = "";
        return { kind: "submit", pin };
      }
      return { kind: "none" };
    },
    get typed() {
      return digits.length;
    },
    clear() {
      digits = "";
    },
  };
}

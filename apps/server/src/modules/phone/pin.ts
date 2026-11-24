/**
 * The keypad PIN with which the owner of a bot proves who they are when they call it. Caller ID alone never does: it can be faked.
 * Stored as a salted scrypt hash, compared in constant time. Three wrong tries lock the PIN for half an hour (`decide` is pure: the
 * service writes what it says).
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { PIN_LENGTH, PIN_LOCK_MINUTES, PIN_MAX_FAILURES } from "@zetta/core/phone";

const KEY_LENGTH = 32;
const COST = { N: 16384, r: 8, p: 1 } as const;

const derive = (pin: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(pin, salt, KEY_LENGTH, COST, (e, key) => (e ? reject(e) : resolve(key))),
  );

/** A PIN is digits only (it is typed on a keypad), four to eight of them. */
export const isPin = (v: string) =>
  new RegExp(`^[0-9]{${PIN_LENGTH.min},${PIN_LENGTH.max}}$`).test(v);

/** `scrypt$<salt>$<hash>`, both base64. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(pin, salt)).toString("base64")}`;
}

export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await derive(pin, Buffer.from(salt, "base64"));
  return want.length === got.length && timingSafeEqual(want, got);
}

export type PinState = { pinHash: string | null; pinFailures: number; pinLockedUntil: Date | null };
export type PinOutcome =
  | { result: "ok"; pinFailures: 0; pinLockedUntil: null }
  | { result: "wrong"; pinFailures: number; pinLockedUntil: Date | null }
  | { result: "locked"; pinFailures: number; pinLockedUntil: Date }
  | { result: "none"; pinFailures: number; pinLockedUntil: null };

/**
 * Checks a PIN against a number's state. While locked, even the right PIN is refused (so guessing in the lock gains nothing). A wrong try
 * counts; the third locks and the count starts again when the lock ends.
 */
export async function decidePin(state: PinState, pin: string, now: Date): Promise<PinOutcome> {
  if (!state.pinHash) return { result: "none", pinFailures: 0, pinLockedUntil: null };
  if (state.pinLockedUntil && state.pinLockedUntil > now)
    return {
      result: "locked",
      pinFailures: state.pinFailures,
      pinLockedUntil: state.pinLockedUntil,
    };
  // A lock that ended starts a fresh count.
  const before = state.pinLockedUntil ? 0 : state.pinFailures;
  if (isPin(pin) && (await verifyPinHash(pin, state.pinHash)))
    return { result: "ok", pinFailures: 0, pinLockedUntil: null };
  const failures = before + 1;
  return {
    result: "wrong",
    pinFailures: failures >= PIN_MAX_FAILURES ? 0 : failures,
    pinLockedUntil:
      failures >= PIN_MAX_FAILURES ? new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) : null,
  };
}

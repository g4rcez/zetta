/**
 * Mobile push (Web Push): a person's choice of what may wake their phone, the limits of a stored subscription, and the checks every
 * subscription goes through. The tables are `user_preference.push_mode` and `push_subscription`; the keys are on `installation_settings`
 * (`push_public_key`) and in a sealed connection. See docs/decisions/feedback-wave2-foundation.md.
 *
 * Only erasable syntax here: the database schema, the server and the web app all import this file.
 */

/** `all`: every card and message that asks for the person. `mentions_and_approvals`: only a mention and a decision waiting. `off`: never. */
export const PUSH_MODES = ["all", "mentions_and_approvals", "off"] as const;
export type PushMode = (typeof PUSH_MODES)[number];
export const DEFAULT_PUSH_MODE: PushMode = "mentions_and_approvals";

/**
 * What a push is about, as the sender sees it. `mention`: somebody wrote the person's name. `approval`: something waits for the person's
 * yes or no (a proposal, a permission request, a bot's question). `other`: every other card or message.
 */
export const PUSH_EVENT_CLASSES = ["mention", "approval", "other"] as const;
export type PushEventClass = (typeof PUSH_EVENT_CLASSES)[number];

/** Whether the person's choice lets this kind of event reach their phone. The sender calls it before it sends. */
export function pushAllows(mode: PushMode, event: PushEventClass): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  return event === "mention" || event === "approval";
}

/** The private VAPID key of the installation: a sealed `connection` of this provider, owned by the administrator who installed it. */
export const PUSH_KEY_CONNECTION_PROVIDER = "push";
export const PUSH_KEY_PURPOSE = "installation.push-key";

/** The public VAPID key: an uncompressed P-256 point (65 bytes) in base64url, 87 characters. */
export const isVapidPublicKey = (key: string) => /^[A-Za-z0-9_-]{87}$/.test(key);

/** Longest values a subscription holds (also CHECKs in the database). */
export const PUSH_LIMITS = {
  endpoint: 2048,
  p256dh: 128,
  auth: 64,
  userAgent: 200,
  /** Devices one person can keep subscribed; the oldest is dropped beyond it. */
  perUser: 20,
} as const;

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
};
export type PushSubscriptionIssue =
  | "endpoint_invalid"
  | "endpoint_not_https"
  | "endpoint_forbidden_host"
  | "endpoint_too_long"
  | "key_invalid";

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Checks a subscription the browser sent, without any network access: `https` only, no user name or password, no IP address or local
 * name as the host (a push service is always a public name), keys in base64url, texts within their limits. The user agent is cut to its
 * limit. The server must still resolve the name and refuse a private address before it ever sends (the same rule as any outgoing call
 * to an address a person supplied).
 */
export function checkPushSubscription(
  input: PushSubscriptionInput,
):
  | { ok: true; value: Required<PushSubscriptionInput> }
  | { ok: false; issue: PushSubscriptionIssue } {
  if (typeof input.endpoint !== "string" || input.endpoint.length > PUSH_LIMITS.endpoint)
    return { ok: false, issue: "endpoint_too_long" };
  let u: URL;
  try {
    u = new URL(input.endpoint);
  } catch {
    return { ok: false, issue: "endpoint_invalid" };
  }
  if (u.protocol !== "https:") return { ok: false, issue: "endpoint_not_https" };
  const host = u.hostname.toLowerCase();
  if (
    u.username ||
    u.password ||
    host.startsWith("[") ||
    IPV4.test(host) ||
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return { ok: false, issue: "endpoint_forbidden_host" };
  const { p256dh, auth } = input;
  if (
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    p256dh.length < 1 ||
    auth.length < 1 ||
    p256dh.length > PUSH_LIMITS.p256dh ||
    auth.length > PUSH_LIMITS.auth ||
    !BASE64URL.test(p256dh) ||
    !BASE64URL.test(auth)
  )
    return { ok: false, issue: "key_invalid" };
  return {
    ok: true,
    value: {
      endpoint: input.endpoint,
      p256dh,
      auth,
      userAgent: String(input.userAgent ?? "").slice(0, PUSH_LIMITS.userAgent),
    },
  };
}

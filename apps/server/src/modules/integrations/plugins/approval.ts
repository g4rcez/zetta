import { createHmac, timingSafeEqual } from "node:crypto";

import { PluginError } from "./registry";

/**
 * Stateless approval for plugin writes. A tool that must wait for the person (see PluginPause in registry.ts) puts the exact call inside
 * the request id, signed with a secret only this user's install knows (their token). `resume` opens it again: nothing is kept in memory
 * or in a table, so the card can be answered by another server process, and a request id nobody signed (or one for another user) opens
 * nothing. The call is the one the card showed; the bot cannot change it after the fact.
 */
const TTL_MS = 30 * 60_000;
const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
const sign = (secret: string, body: string) =>
  createHmac("sha256", createHmac("sha256", "zetta-plugin-approval-v1").update(secret).digest())
    .update(body)
    .digest();

export type PendingCall = { tool: string; args: Record<string, unknown> };

/** The request id and its deadline for one call that waits for the person. */
export function sealPending(secret: string, call: PendingCall, now = Date.now()) {
  const expiresAt = now + TTL_MS;
  const body = b64(JSON.stringify({ t: call.tool, a: call.args, e: expiresAt }));
  return { requestId: `p1.${body}.${b64(sign(secret, body))}`, expiresAt };
}

const expired = () =>
  new PluginError(
    "EXPIRED",
    "That approval is no longer valid.",
    "Ask for the change again to get a new card.",
  );

/** The call a request id carries, when this install signed it and it has not expired. Throws EXPIRED otherwise. */
export function openPending(secret: string, requestId: string, now = Date.now()): PendingCall {
  const [v, body, sig] = requestId.split(".");
  if (v !== "p1" || !body || !sig) throw expired();
  const want = sign(secret, body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw expired();
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      t?: unknown;
      a?: unknown;
      e?: unknown;
    };
    if (typeof p.t !== "string" || typeof p.e !== "number" || now > p.e) throw expired();
    if (!p.a || typeof p.a !== "object" || Array.isArray(p.a)) throw expired();
    return { tool: p.t, args: p.a as Record<string, unknown> };
  } catch {
    throw expired();
  }
}

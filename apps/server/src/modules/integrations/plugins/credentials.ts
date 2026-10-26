import type { FocusedInput } from "../../computer/cdp";
import type { CredentialField } from "./registry";

/**
 * Where a granted credential may be typed. An origin pattern is a host (`github.com`, exact match) or a wildcard host (`*.example.com`,
 * its subdomains and itself). Only https pages qualify: a password is never typed into a page that travels in clear text.
 * Patterns are stored normalized (lowercase, no scheme, path or port).
 */
const HOST = /^(\*\.)?([a-z0-9-]{1,63}\.)+[a-z][a-z0-9-]{1,62}$/;
export const CREDENTIAL_FIELDS: readonly CredentialField[] = ["username", "password", "totp"];

/** `https://GitHub.com/login` -> `github.com`; `*.Example.com` -> `*.example.com`; anything else (IPs, localhost, single labels) -> undefined. */
export function originPattern(raw: string): string | undefined {
  let v = raw.trim().toLowerCase();
  if (!v) return undefined;
  const wild = v.startsWith("*.");
  if (wild) v = v.slice(2);
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(v)) v = `https://${v}`;
  let host: string;
  try { const u = new URL(v); if (u.protocol !== "https:" && u.protocol !== "http:") return undefined; host = u.hostname.replace(/\.$/, ""); } catch { return undefined; }
  const out = `${wild ? "*." : ""}${host}`;
  return HOST.test(out) ? out : undefined;
}

/** True when `pageUrl` is an https page whose host matches one of the patterns. */
export function originAllowed(pageUrl: string, patterns: readonly string[]): boolean {
  let host: string;
  try { const u = new URL(pageUrl); if (u.protocol !== "https:" || u.username || u.password) return false; host = u.hostname.toLowerCase().replace(/\.$/, ""); } catch { return false; }
  return patterns.some((p) => p.startsWith("*.") ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p);
}

/** One row of cua-driver's `get_window_state` (tree_format "elements"): role, label and a window-relative frame; no value, no focus state. */
export type AxElement = { role?: string; label?: string; enabled?: boolean; in_web_content?: boolean; frame?: { x: number; y: number; w: number; h: number } };
const TOTP_LABEL = /one[- ]time|otp|totp|2fa|two[- ]factor|verification|authenticat|security code|\bcode\b/i;
/**
 * Desktop VMs: the server, not the bot, picks the input a credential goes into, from the page's own accessibility tree (checked against
 * Chromium on cua-spacesd 0.8.0, e.g. GitHub: `entry "Username or email address"`, `password text "Password"`). A password only ever goes
 * into a password field; a username into a text field labelled like one (or the text field right before the password); a code into a
 * field labelled like one. Undefined means no fitting input: nothing is typed.
 */
export function pickInput(field: CredentialField, elements: readonly AxElement[]): AxElement | undefined {
  const inputs = elements.filter((e) => e.in_web_content && e.enabled !== false && e.frame && e.frame.w > 0 && e.frame.h > 0 && (e.role === "entry" || e.role === "password text"));
  if (field === "password") return inputs.find((e) => e.role === "password text");
  const entries = inputs.filter((e) => e.role === "entry");
  if (field === "totp") return entries.find((e) => TOTP_LABEL.test(e.label ?? ""));
  const named = entries.find((e) => /user|e-?mail|login|account|identifier|phone/i.test(e.label ?? "") && !/search/i.test(e.label ?? ""));
  if (named) return named;
  const pw = inputs.findIndex((e) => e.role === "password text"), prev = pw > 0 ? inputs[pw - 1] : undefined;
  return prev?.role === "entry" && !/search|code/i.test(prev.label ?? "") ? prev : undefined;
}

/** Field kinds an input element may receive: a password only goes into a password input, never into a comment box on the right site. */
export function fieldFits(field: CredentialField, f: FocusedInput | null | undefined): boolean {
  if (!f || f.tag !== "input") return false;
  const hint = `${f.autocomplete} ${f.name}`.toLowerCase();
  if (field === "password") return f.type === "password";
  if (field === "username") return ["text", "email", "tel", ""].includes(f.type) && (/username|email|login|user|account|identifier/.test(hint) || f.type === "email");
  return ["text", "tel", "number", ""].includes(f.type) && (/one-time-code|otp|totp|2fa|mfa|code|token/.test(hint) || f.inputmode === "numeric");
}

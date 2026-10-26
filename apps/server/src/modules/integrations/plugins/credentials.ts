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

/**
 * Desktop VMs are only readable through Chromium's accessibility tree (cua-driver rows such as `- [12] entry "Address and search bar" value="github.com/login"`).
 * The address bar hides "https://" and marks plain-http pages "Not secure", so a bare address counts as https unless that mark is shown.
 * Anything unrecognised gives undefined, and the fill is refused instead of guessed.
 */
export function desktopPage(tree: string): string | undefined {
  const line = tree.split("\n").find((l) => /address and search bar/i.test(l));
  if (!line) return undefined;
  const after = line.slice(line.search(/address and search bar/i) + "address and search bar".length);
  const m = /(https?:\/\/[^\s"'<>]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s"'<>]*)?)/i.exec(after);
  if (!m || /not secure/i.test(tree)) return undefined;
  return /^https?:\/\//i.test(m[1]!) ? m[1] : `https://${m[1]}`;
}
/** Desktop field check: the tree must mark which element is focused, and that row must look like the right kind of input. */
export function desktopFieldFits(field: CredentialField, tree: string): boolean {
  const row = tree.split("\n").find((l) => /\bfocused\b/i.test(l) && !/address and search bar/i.test(l));
  if (!row || !/\b(entry|text|textbox|input|edit|password)\b/i.test(row)) return false;
  const password = /password/i.test(row);
  if (field === "password") return password;
  if (password) return false;
  return field === "username" ? /user|email|login|account|identifier/i.test(row) : /one-time|otp|totp|2fa|code|token/i.test(row);
}

/** Field kinds an input element may receive: a password only goes into a password input, never into a comment box on the right site. */
export function fieldFits(field: CredentialField, f: FocusedInput | null | undefined): boolean {
  if (!f || f.tag !== "input") return false;
  const hint = `${f.autocomplete} ${f.name}`.toLowerCase();
  if (field === "password") return f.type === "password";
  if (field === "username") return ["text", "email", "tel", ""].includes(f.type) && (/username|email|login|user|account|identifier/.test(hint) || f.type === "email");
  return ["text", "tel", "number", ""].includes(f.type) && (/one-time-code|otp|totp|2fa|mfa|code|token/.test(hint) || f.inputmode === "numeric");
}

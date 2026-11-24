/**
 * Bot e-mail addresses: what the administrator chose for the whole installation. The columns live on `installation_settings`
 * (`mail_*`); the provider's API key is a sealed connection, never a column. See docs/decisions/channels-and-inputs.md.
 *
 * Only erasable syntax here: the database schema, the server and the web app all import this file.
 */

/** `off`: bots get no automatic address. `resend`: addresses of the installation's own domain, mail received and sent through Resend. */
export const MAIL_PROVIDERS = ["off", "resend"] as const;
export type MailProviderName = (typeof MAIL_PROVIDERS)[number];
export const DEFAULT_MAIL_PROVIDER: MailProviderName = "off";

/** Longest values the columns hold (also CHECKs in the database). */
export const MAIL_LIMITS = { domain: 253, cursor: 200 } as const;

/** The sealed key of the installation's mail provider: a `connection` of this provider, saved with this transport purpose. */
export const MAIL_KEY_CONNECTION_PROVIDER = "mailprovider";
export const MAIL_KEY_PURPOSE = "installation.mail-key";

/** The words a person's address is built from: lower case letters, digits and dashes, at most 64 characters before the `@`. */
export const MAIL_LOCAL_MAX = 64;

const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A domain as typed: trimmed, lower case, no `@` in front. Empty stays empty. */
export const normalizeMailDomain = (raw: string) => raw.trim().toLowerCase().replace(/^@/, "");
export const isMailDomain = (v: string) => DOMAIN.test(v);

export type MailSettings = {
  mailProvider: MailProviderName;
  mailDomain: string;
};
export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  mailProvider: DEFAULT_MAIL_PROVIDER,
  mailDomain: "",
};

/** Why a set of mail settings cannot be saved, or null. A provider other than `off` needs a domain that looks like one. */
export function mailSettingsIssue(s: MailSettings): string | null {
  if (!(MAIL_PROVIDERS as readonly string[]).includes(s.mailProvider))
    return "That is not a mail provider.";
  if (s.mailDomain.length > MAIL_LIMITS.domain) return "The domain is too long.";
  if (s.mailProvider !== "off" && !isMailDomain(s.mailDomain))
    return "Give the domain bot addresses will use, for example mail.example.com.";
  if (s.mailDomain && !isMailDomain(s.mailDomain)) return "That is not a domain name.";
  return null;
}

/** The parts of an installation that turn the feature on: a provider, a domain and a key. */
export const mailIsOn = (s: MailSettings, keyState: string) =>
  s.mailProvider !== "off" && s.mailDomain !== "" && keyState === "set";

/** Addresses or `@domains` a person allowed to write to a bot's mailbox. */
export const SENDER_PATTERN = /^(@?[a-z0-9.-]+\.[a-z]{2,}|[^\s@]+@[a-z0-9.-]+\.[a-z]{2,})$/;

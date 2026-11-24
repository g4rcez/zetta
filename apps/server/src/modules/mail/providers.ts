/**
 * Mail server detection for the connect form: given an address, suggest the servers. It is a suggestion; the person can edit every field,
 * and the hosts found here are still checked by the private-address policy when the connection is tried (`imap-connect.ts`).
 *
 * Sources, in order: a static table of the providers that accept an app password over IMAP; the RFC 6186 SRV records of the domain
 * (`_imaps._tcp`, `_submission._tcp`); the MX record, to recognise who hosts the domain. Only DNS and the table are used: no third-party
 * lookup service. DNS goes through a resolver the caller can replace.
 *
 * The table's server names come from each provider's own help pages (see `docsUrl`), read on 2026-11-22. An entry marked `unchecked` could
 * not be confirmed on the provider's page and is shown to the person as unconfirmed.
 */
import { resolveMx, resolveSrv } from "node:dns/promises";
import { isMailHost, type MailSecurity } from "./imap-connect";

export type DnsResolver = {
  srv(name: string): Promise<{ name: string; port: number; priority: number; weight: number }[]>;
  mx(name: string): Promise<{ exchange: string; priority: number }[]>;
};
/** The system resolver. A name that does not exist answers an empty list. */
export const systemResolver: DnsResolver = {
  srv: (n) => resolveSrv(n).catch(() => []),
  mx: (n) => resolveMx(n).catch(() => []),
};

export type ServerSuggestion = { host: string; port: number; security: MailSecurity };
/** `checked`: the names and ports were confirmed on the provider's own page. `unchecked`: they were not. */
export type Confidence = "checked" | "unchecked";

/**
 * `known`: a provider of the table (an app password works). `dns`: the domain publishes its own servers. `google`: the domain is hosted by
 * Google. `microsoft`: hosted by Microsoft, which no longer accepts a password over IMAP: it is connected through the Microsoft plugin
 * (the route adds `next`, see below). `unknown`: nothing found, type the servers.
 * `invalid`: the text is not an address.
 */
export type DetectStatus = "known" | "dns" | "google" | "microsoft" | "unknown" | "invalid";

export type Detection = {
  status: DetectStatus;
  /** The sentence for the person. */
  message: string;
  provider?: { id: string; label: string };
  imap?: ServerSuggestion;
  smtp?: ServerSuggestion;
  /** What to sign in with. */
  user?: string;
  /** Where the person creates an app password, when the provider asks for one. */
  appPasswordUrl?: string;
  confidence?: Confidence;
  /**
   * Where to go for an address that is not connected by server settings: its mailbox, when the Microsoft account is already connected, or
   * the plugin that connects it. Set by the route (it needs the person), never by `detectMailServers`.
   */
  next?: { type: "mailbox"; mailboxId: string } | { type: "plugin"; pluginId: string };
};

type Entry = {
  id: string;
  label: string;
  domains: string[];
  /** MX host suffixes of a domain this provider hosts. */
  mx?: string[];
  imap: ServerSuggestion;
  smtp: ServerSuggestion;
  appPasswordUrl?: string;
  docsUrl: string;
  confidence: Confidence;
  note: string;
};

const tls = (host: string, port = 993): ServerSuggestion => ({ host, port, security: "tls" });
const starttls = (host: string, port = 587): ServerSuggestion => ({
  host,
  port,
  security: "starttls",
});

export const PROVIDER_TABLE: readonly Entry[] = [
  {
    id: "icloud",
    label: "iCloud Mail",
    domains: ["icloud.com", "me.com", "mac.com"],
    mx: [".mail.icloud.com"],
    imap: tls("imap.mail.me.com"),
    smtp: starttls("smtp.mail.me.com"),
    appPasswordUrl: "https://account.apple.com",
    docsUrl: "https://support.apple.com/en-us/102525",
    confidence: "checked",
    note: "Use an app-specific password (the Apple Account needs two-factor authentication). If the full address is refused, try the part before the @.",
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    domains: ["yahoo.com", "ymail.com", "rocketmail.com"],
    imap: tls("imap.mail.yahoo.com"),
    smtp: tls("smtp.mail.yahoo.com", 465),
    appPasswordUrl: "https://login.yahoo.com/account/security",
    docsUrl: "https://help.yahoo.com/kb/SLN4075.html",
    confidence: "checked",
    note: "Yahoo asks for an app password, not your account password.",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    domains: ["fastmail.com", "fastmail.fm"],
    mx: [".messagingengine.com"],
    imap: tls("imap.fastmail.com"),
    smtp: tls("smtp.fastmail.com", 465),
    docsUrl: "https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports",
    confidence: "checked",
    note: "Use an app password (Settings, Privacy & Security, Manage app passwords and access). Basic plans do not include IMAP or SMTP access.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    domains: ["zoho.com", "zohomail.com"],
    imap: tls("imap.zoho.com"),
    smtp: tls("smtp.zoho.com", 465),
    appPasswordUrl: "https://accounts.zoho.com/home#security/app_password",
    docsUrl: "https://www.zoho.com/mail/help/imap-access.html",
    confidence: "checked",
    note: "Turn on IMAP access in Zoho Mail first. With two-factor authentication use an app-specific password. A paid account on your own domain uses imappro.zoho.com, and other data centers (.eu, .in, ...) have their own names: use the ones in your Zoho settings.",
  },
  {
    id: "gmx",
    label: "GMX",
    domains: ["gmx.com"],
    imap: tls("imap.gmx.com"),
    smtp: tls("mail.gmx.com", 465),
    docsUrl: "https://support.gmx.com/pop-imap/imap/server.html",
    confidence: "checked",
    note: "GMX's page does not say whether an app password is needed. If sign-in fails, check the external-access settings of the account.",
  },
  {
    id: "mailcom",
    label: "mail.com",
    domains: ["mail.com"],
    imap: tls("imap.mail.com"),
    smtp: tls("smtp.mail.com", 465),
    docsUrl: "https://support.mail.com/pop-imap/imap/server.html",
    confidence: "checked",
    note: "mail.com's page does not say whether an app password is needed. If sign-in fails, check the external-access settings of the account.",
  },
  {
    id: "aol",
    label: "AOL Mail",
    domains: ["aol.com"],
    imap: tls("imap.aol.com"),
    smtp: tls("smtp.aol.com", 465),
    appPasswordUrl: "https://login.aol.com/account/security",
    docsUrl: "https://help.aol.com/articles/download-your-email-from-aol-mail-with-imap",
    confidence: "unchecked",
    note: "These server names are not confirmed on AOL's own page (it was not readable); check them. AOL asks for an app password.",
  },
];

/** Hosted by Google: the Gmail domains here, any other by its MX. */
const GOOGLE_DOMAINS = ["gmail.com", "googlemail.com"];
const GOOGLE_MX = [".google.com", ".googlemail.com"];
/** Hosted by Microsoft: the consumer domains here (Outlook.com, Hotmail, Live), any other by its MX (Microsoft 365). */
const MICROSOFT_DOMAINS = ["outlook.com", "hotmail.com", "live.com", "msn.com"];
const MICROSOFT_MX = [".mail.protection.outlook.com", ".outlook.com", ".hotmail.com"];

const GOOGLE_IMAP = tls("imap.gmail.com");
const GOOGLE_SMTP = tls("smtp.gmail.com", 465);
const GOOGLE_APP_PASSWORDS = "https://support.google.com/accounts/answer/185833";

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const ADDRESS = /^[^\s<>@,;"()\\]+@([^\s<>@,;"()\\]+)$/;

const endsWithAny = (host: string, suffixes: readonly string[]) =>
  suffixes.some((s) => host === s.slice(1) || host.endsWith(s));
const clean = (h: string) => h.trim().toLowerCase().replace(/\.$/, "");

const known = (e: Entry, address: string): Detection => ({
  status: "known",
  message: e.note,
  provider: { id: e.id, label: e.label },
  imap: e.imap,
  smtp: e.smtp,
  user: address,
  ...(e.appPasswordUrl ? { appPasswordUrl: e.appPasswordUrl } : {}),
  confidence: e.confidence,
});
const google = (): Detection => ({
  status: "google",
  message:
    "This address is hosted by Google. Use the Google connection. If you must use a password, create an app password (it needs 2-Step Verification) and use the servers below.",
  provider: { id: "google", label: "Google" },
  imap: GOOGLE_IMAP,
  smtp: GOOGLE_SMTP,
  appPasswordUrl: GOOGLE_APP_PASSWORDS,
  confidence: "unchecked",
});
const microsoft = (): Detection => ({
  status: "microsoft",
  message:
    "Microsoft no longer accepts a password for IMAP on Outlook.com, Hotmail, Live and Microsoft 365: it asks for sign-in with Microsoft (OAuth). Zetta connects it through the Microsoft plugin, with your own Microsoft app registration.",
  provider: { id: "microsoft", label: "Microsoft" },
});

/** The SRV answer as a server, or undefined: a target of "." means the service is not offered, and a host that is not a mail host is ignored. */
const fromSrv = (
  records: { name: string; port: number; priority: number; weight: number }[],
  secureByDefault: (port: number) => MailSecurity,
): ServerSuggestion | undefined => {
  const best = [...records]
    .map((r) => ({ ...r, name: clean(r.name) }))
    .filter((r) => r.name && r.name !== "." && isMailHost(r.name) && r.port > 0 && r.port < 65536)
    .sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
  return best
    ? { host: best.name, port: best.port, security: secureByDefault(best.port) }
    : undefined;
};

/** Suggests the mail servers for an address. Never throws: a DNS failure is "nothing found". */
export async function detectMailServers(
  rawAddress: string,
  dns: DnsResolver = systemResolver,
): Promise<Detection> {
  const address = rawAddress.trim();
  const domain = clean(ADDRESS.exec(address)?.[1] ?? "");
  if (address.length > 320 || !DOMAIN.test(domain))
    return { status: "invalid", message: "That is not an e-mail address." };

  const entry = PROVIDER_TABLE.find((e) => e.domains.includes(domain));
  if (entry) return known(entry, address);
  if (GOOGLE_DOMAINS.includes(domain)) return google();
  if (MICROSOFT_DOMAINS.includes(domain)) return microsoft();

  const [imap, smtp] = await Promise.all([
    dns.srv(`_imaps._tcp.${domain}`).catch(() => []),
    dns.srv(`_submission._tcp.${domain}`).catch(() => []),
  ]);
  const imapServer = fromSrv(imap, () => "tls");
  if (imapServer) {
    const smtpServer = fromSrv(smtp, (p) => (p === 465 ? "tls" : "starttls"));
    return {
      status: "dns",
      message: smtpServer
        ? `${domain} publishes its mail servers. Check them, then enter your password.`
        : `${domain} publishes its reading server but not its sending server. Enter the sending server yourself.`,
      imap: imapServer,
      ...(smtpServer ? { smtp: smtpServer } : {}),
      user: address,
      confidence: "checked",
    };
  }

  const hosts = (await dns.mx(domain).catch(() => []))
    .sort((a, b) => a.priority - b.priority)
    .map((m) => clean(m.exchange));
  if (hosts.some((h) => endsWithAny(h, GOOGLE_MX))) return google();
  if (hosts.some((h) => endsWithAny(h, MICROSOFT_MX))) return microsoft();
  const hosted = PROVIDER_TABLE.find((e) => e.mx && hosts.some((h) => endsWithAny(h, e.mx!)));
  if (hosted) return known(hosted, address);

  return {
    status: "unknown",
    message: "The mail servers of this address could not be found. Enter them yourself.",
    user: address,
  };
}

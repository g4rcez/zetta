import type { ImapFlowOptions } from "imapflow";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { assertPublicUrl } from "../computer/service";
import { privateAllowed, type PrivateNetwork } from "../settings/private-network";

/**
 * What every IMAP and SMTP caller shares: the address policy for the hosts a person types, the host pattern, the sentences a failure turns
 * into, and the options of the two clients. The e-mail plugin (a channel for outside people) and the mailbox driver (a person's own
 * inbox) both read mail through here, so the rules are written once. Nothing here reads or sends a message.
 */

let policy: PrivateNetwork = false;
/** Called once at start-up with the `allowPrivate` option (a function asked at every check, or a fixed answer in tests); mail servers on a private network stay blocked without it. */
export const configureMailPolicy = (p: { allowPrivate?: PrivateNetwork }) => {
  policy = p.allowPrivate ?? false;
};

/** A host name as a mail server is written: letters, digits, dots and dashes, at most 253 characters. */
export const MAIL_HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
export const isMailHost = (h: string) => h.length <= 253 && MAIL_HOST.test(h);

/** `tls`: the connection is encrypted from the first byte (port 993 and 465). `starttls`: it starts plain and upgrades (143 and 587). */
export type MailSecurity = "tls" | "starttls";
export type MailServer = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
  /** Left out: the port decides (993 and 465 are `tls`). */
  imapSecurity?: MailSecurity;
  smtpSecurity?: MailSecurity;
};

/** A mail failure the person can read and act on. `code` is stable; `safe` and `fix` never hold the server's own words. */
export class MailConnectError extends Error {
  constructor(
    readonly code: string,
    readonly safe: string,
    readonly fix?: string,
  ) {
    super(code);
    this.name = "MailConnectError";
  }
}

/** The mail servers are typed by the person: the same address policy as every other user-supplied host. */
export async function assertMailHosts(hosts: readonly string[]) {
  if (await privateAllowed(policy)) return;
  for (const h of hosts)
    await assertPublicUrl(`https://${h}`).catch(() => {
      throw new MailConnectError(
        "BLOCKED_URL",
        "That mail server address is not allowed (private addresses must be enabled by the administrator).",
      );
    });
}

const AUTH_FIX = "Check them (Gmail and Outlook need an app password).";

/**
 * Maps an IMAP or SMTP failure to what the person can act on, never the server's own words (they can hold the user name or the address).
 * `authFix` is the advice for a refused password, which depends on where the person fixes it.
 */
export function mailFailure(
  e: unknown,
  what: string,
  authFix: string = AUTH_FIX,
): MailConnectError {
  if (e instanceof MailConnectError) return e;
  const code = String((e as { code?: unknown; responseStatus?: unknown })?.code ?? "");
  const auth =
    /AUTH|EAUTH/i.test(code) || (e as { authenticationFailed?: boolean })?.authenticationFailed;
  if (auth)
    return new MailConnectError(
      "AUTH",
      "The mail server did not accept the user name and password.",
      authFix,
    );
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ESOCKET|EDNS/i.test(code))
    return new MailConnectError(
      "UNREACHABLE",
      `The mail server could not be reached to ${what}.`,
      "Check the server name and port.",
    );
  return new MailConnectError("MAIL_ERROR", `The mail server refused to ${what}.`);
}

/** Options of an `ImapFlow` client: no logging (it would print the password), bounded waits. */
export function imapOptions(
  s: MailServer,
  o: { socketTimeout: number; greetingTimeout?: number },
): ImapFlowOptions {
  return {
    host: s.imapHost,
    port: s.imapPort,
    secure: (s.imapSecurity ?? (s.imapPort === 993 ? "tls" : "starttls")) === "tls",
    auth: { user: s.user, pass: s.password },
    logger: false,
    socketTimeout: o.socketTimeout,
    greetingTimeout: o.greetingTimeout ?? 10_000,
  };
}

/** Options of a `nodemailer` SMTP transport: bounded waits, and a message can never pull a file or an address into itself. */
export function smtpOptions(
  s: MailServer,
  o: {
    connectionTimeout: number;
    greetingTimeout?: number;
    socketTimeout?: number;
    locked?: boolean;
  },
): SMTPTransport.Options {
  return {
    host: s.smtpHost,
    port: s.smtpPort,
    secure: (s.smtpSecurity ?? (s.smtpPort === 465 ? "tls" : "starttls")) === "tls",
    auth: { user: s.user, pass: s.password },
    connectionTimeout: o.connectionTimeout,
    ...(o.greetingTimeout ? { greetingTimeout: o.greetingTimeout } : {}),
    ...(o.socketTimeout ? { socketTimeout: o.socketTimeout } : {}),
    ...(o.locked ? { disableFileAccess: true, disableUrlAccess: true } : {}),
  };
}

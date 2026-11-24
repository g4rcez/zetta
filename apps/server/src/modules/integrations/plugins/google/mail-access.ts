import type { ActiveActor } from "../../../identity/access";
import type { GmailRequest, GmailTransport } from "../../../mail/drivers/google";
import { MailConnectError } from "../../../mail/imap-connect";
import { PluginError, type PluginContext } from "../registry";
import { gfetch, grantedScopes, pickAccount, readAccounts, settings, type ScopeId } from "./oauth";

/**
 * How the mailbox module borrows the person's Google connection (modules/mail/drivers/google.ts). The tokens stay in the Google plugin's
 * sealed configuration: nothing here copies one into a mailbox row, a log or a result. A call asks the plugin for the account's access
 * token for that one request, and the plugin refreshes it (and writes the refreshed one back to its own configuration) as it does for a
 * bot's Gmail tool.
 *
 * Only the person's own installation is used, never a team configuration: a mailbox is one person's, and a team's Google account must not
 * show up as the mailbox of every member.
 */
export type GoogleMailAccount = {
  /** Lower case, as the plugin keeps it. */
  email: string;
  /** Whether the person can still sign in with it: a refused or revoked token takes the permissions away, and this with them. */
  connected: boolean;
  /** The Gmail permission to read mail was granted. */
  read: boolean;
  /** The Gmail permission to send mail was granted. */
  send: boolean;
};

export type GoogleMailAccess = {
  /** The Google accounts of this person's own installation; none when Google is not installed. */
  accounts(a: ActiveActor): Promise<GoogleMailAccount[]>;
  /** The Gmail calls of one account. The plugin context is read once per transport, so one request shares one view of the account. */
  transport(a: ActiveActor, email: string): GmailTransport;
};

const PLUGIN = "Studio > Plugins > Google";
const SCOPE: Record<GmailRequest["scope"], ScopeId> = {
  read: "gmail.readonly",
  send: "gmail.send",
};
const SCOPE_WORDS: Record<GmailRequest["scope"], string> = {
  read: "read messages",
  send: "send email",
};

/** What a failure of the Google plugin says to a person who is looking at a mailbox. The words are ours; Google's never pass through. */
export function mailErrorOf(e: unknown, scope: GmailRequest["scope"]): MailConnectError {
  if (e instanceof MailConnectError) return e;
  if (!(e instanceof PluginError))
    return new MailConnectError("MAIL_ERROR", "Gmail could not be read right now.");
  switch (e.code) {
    case "NEEDS_AUTH":
      return new MailConnectError(
        "AUTH",
        "Google access for this mailbox was revoked or has expired.",
        `Sign in with Google again in ${PLUGIN}.`,
      );
    case "UNKNOWN_ACCOUNT":
      return new MailConnectError(
        "AUTH",
        "This Google account is not connected any more.",
        `Connect it again in ${PLUGIN}.`,
      );
    case "SCOPE_MISSING":
      return new MailConnectError(
        scope === "read" ? "AUTH" : "SEND_SCOPE",
        `Zetta was not given permission to ${SCOPE_WORDS[scope]} for this Google account.`,
        `Open ${PLUGIN}, choose Change permissions on this account, tick "${scope === "read" ? "Gmail: read messages" : "Gmail: send email"}" and sign in with Google again.`,
      );
    case "GOOGLE_UNAVAILABLE":
      return new MailConnectError(
        "UNREACHABLE",
        "Google could not be reached.",
        "Try again in a moment.",
      );
    case "API_NOT_ENABLED":
      return new MailConnectError("MAIL_ERROR", e.safe, e.fix);
    case "NOT_FOUND":
    case "GONE":
      return new MailConnectError("NOT_FOUND", "Gmail no longer has that message.");
    case "RATE_LIMITED":
      return new MailConnectError(
        "RATE_LIMITED",
        "Google is rate limiting requests.",
        "Try again in a moment.",
      );
    case "FORBIDDEN":
      return new MailConnectError(
        "MAIL_ERROR",
        "Google denied reading this mailbox (a permission is missing, or the Gmail API is not enabled in your Google Cloud project).",
        `Check ${PLUGIN}.`,
      );
    default:
      return new MailConnectError("MAIL_ERROR", "Gmail refused to complete that.");
  }
}

export function createGoogleMailAccess(deps: {
  /** The person's own Google installation, or undefined when there is none (`plugins.ownContextFor`). */
  context: (a: ActiveActor) => Promise<PluginContext | undefined>;
}): GoogleMailAccess {
  return {
    async accounts(a) {
      const ctx = await deps.context(a);
      if (!ctx) return [];
      return readAccounts(ctx.config).map((acc) => {
        const granted = grantedScopes(acc);
        const connected = Boolean(acc.refreshToken);
        return {
          email: acc.email.toLowerCase(),
          connected,
          read: connected && granted.has("gmail.readonly"),
          send: connected && granted.has("gmail.send"),
        };
      });
    },

    transport(a, email) {
      let ctx: Promise<PluginContext | undefined> | undefined;
      return async (r) => {
        try {
          ctx ??= deps.context(a);
          const base = await ctx;
          if (!base) throw new PluginError("NEEDS_AUTH");
          // A scope the account lacks is refused here, before any request: `pickAccount` knows the plugin's own words for it.
          const account = readAccounts(base.config).find((x) => x.email === email.toLowerCase());
          if (!account) throw new PluginError("UNKNOWN_ACCOUNT");
          const view = pickAccount(base, account.email, SCOPE[r.scope]);
          const url = new URL(`${settings().gmailBase}/users/me${r.path}`);
          for (const [k, v] of Object.entries(r.query ?? {}))
            for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
          const res = await gfetch(view, url.toString(), {
            method: r.method,
            ...(r.json !== undefined ? { json: r.json } : {}),
          });
          return await res.json();
        } catch (e) {
          throw mailErrorOf(e, r.scope);
        }
      };
    },
  };
}

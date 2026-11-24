import type { ActiveActor } from "../../../identity/access";
import type { GraphRequest, GraphTransport } from "../../../mail/drivers/microsoft";
import { MailConnectError } from "../../../mail/imap-connect";
import { PluginError, type PluginContext } from "../registry";
import {
  graphFetch,
  grantedScopes,
  pickAccount,
  readAccounts,
  settings,
  type ScopeId,
} from "./oauth";

/**
 * How the mailbox module borrows the person's Microsoft connection (modules/mail/drivers/microsoft.ts). The tokens stay in the Microsoft
 * plugin's sealed configuration: nothing here copies one into a mailbox row, a log or a result. A call asks the plugin for the account's
 * access token for that one request, and the plugin refreshes it (and writes the refreshed one back to its own configuration).
 *
 * Only the person's own installation is used, never a team configuration: a mailbox is one person's.
 */
export type MicrosoftMailAccount = {
  /** Lower case, as the plugin keeps it. */
  email: string;
  /** Whether the person can still sign in with it: a refused or revoked token takes the permissions away, and this with them. */
  connected: boolean;
  /** Mail.Read was granted. */
  read: boolean;
  /** Mail.Send was granted. */
  send: boolean;
};

export type MicrosoftMailAccess = {
  /** The Microsoft accounts of this person's own installation; none when Microsoft is not installed. */
  accounts(a: ActiveActor): Promise<MicrosoftMailAccount[]>;
  /** The Graph calls of one account. The plugin context is read once per transport, so one request shares one view of the account. */
  transport(a: ActiveActor, email: string): GraphTransport;
};

const PLUGIN = "Studio > Plugins > Microsoft";
const SCOPE: Record<GraphRequest["scope"], ScopeId> = { read: "Mail.Read", send: "Mail.Send" };
const SCOPE_WORDS: Record<GraphRequest["scope"], string> = {
  read: "read messages",
  send: "send email",
};

/** What a failure of the Microsoft plugin says to a person who is looking at a mailbox. The words are ours; Microsoft's never pass through. */
export function mailErrorOf(e: unknown, scope: GraphRequest["scope"]): MailConnectError {
  if (e instanceof MailConnectError) return e;
  if (!(e instanceof PluginError))
    return new MailConnectError("MAIL_ERROR", "Outlook could not be read right now.");
  switch (e.code) {
    case "NEEDS_AUTH":
      return new MailConnectError(
        "AUTH",
        "Microsoft access for this mailbox was revoked or has expired.",
        `Sign in with Microsoft again in ${PLUGIN}.`,
      );
    case "UNKNOWN_ACCOUNT":
      return new MailConnectError(
        "AUTH",
        "This Microsoft account is not connected any more.",
        `Connect it again in ${PLUGIN}.`,
      );
    case "SCOPE_MISSING":
      return new MailConnectError(
        scope === "read" ? "AUTH" : "SEND_SCOPE",
        `Zetta was not given permission to ${SCOPE_WORDS[scope]} for this Microsoft account.`,
        `Open ${PLUGIN}, choose Change permissions on this account, tick "${scope === "read" ? "Mail: read messages" : "Mail: send email"}" and sign in with Microsoft again.`,
      );
    case "MICROSOFT_UNAVAILABLE":
      return new MailConnectError(
        "UNREACHABLE",
        "Microsoft could not be reached.",
        "Try again in a moment.",
      );
    case "NOT_FOUND":
    case "GONE":
      return new MailConnectError("NOT_FOUND", "Outlook no longer has that message.");
    case "RATE_LIMITED":
      return new MailConnectError(
        "RATE_LIMITED",
        "Microsoft is rate limiting requests.",
        "Try again in a moment.",
      );
    case "BAD_REQUEST":
      return new MailConnectError("BAD_INPUT", "Microsoft did not accept that request.");
    case "FORBIDDEN":
      return new MailConnectError(
        "MAIL_ERROR",
        "Microsoft denied reading this mailbox (a permission is missing, or your organization has not allowed the app: an administrator may need to grant consent).",
        `Check ${PLUGIN}.`,
      );
    default:
      return new MailConnectError("MAIL_ERROR", "Outlook refused to complete that.");
  }
}

/** Microsoft's own cap on a file is far higher than ours; this keeps one answer from filling memory before the driver's check. */
const MAX_BYTES = 12_000_000;

export function createMicrosoftMailAccess(deps: {
  /** The person's own Microsoft installation, or undefined when there is none (`plugins.ownContextFor`). */
  context: (a: ActiveActor) => Promise<PluginContext | undefined>;
}): MicrosoftMailAccess {
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
          read: connected && granted.has("Mail.Read"),
          send: connected && granted.has("Mail.Send"),
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
          const view = pickAccount(base, email, SCOPE[r.scope]);
          const url = new URL(`${settings(base.config).graphBase}${r.path}`);
          for (const [k, v] of Object.entries(r.query ?? {})) url.searchParams.set(k, v);
          const res = await graphFetch(view, url.toString(), {
            method: r.method,
            // Immutable ids: a message keeps its id when it is moved to another folder.
            headers: { prefer: 'IdType="ImmutableId"' },
            ...(r.json !== undefined ? { json: r.json } : {}),
          });
          if (r.as === "bytes") {
            const length = Number(res.headers.get("content-length") ?? 0);
            if (length > MAX_BYTES)
              throw new MailConnectError("TOO_LARGE", "That file is too large to download here.");
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.length > MAX_BYTES)
              throw new MailConnectError("TOO_LARGE", "That file is too large to download here.");
            return bytes;
          }
          // sendMail and reply answer 202 with no body.
          return await res.json().catch(() => ({}));
        } catch (e) {
          throw mailErrorOf(e, r.scope);
        }
      };
    },
  };
}

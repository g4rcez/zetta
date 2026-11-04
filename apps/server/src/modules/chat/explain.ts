import { DEFAULT_SAFE, PluginError } from "../integrations/plugins/registry";

/**
 * Explained failures. When a tool a bot used fails, both sides need the same three things: what happened, why, and what to do about it.
 * The user gets a callout in the chat (a `zetta:ui` Alert built here, never by the model) so they know what to ask their bot or fix
 * themselves; the bot gets the same text so it can explain it in its own words and stop retrying the identical call.
 *
 * Every text here is written for people and contains no secrets: plugin errors carry their own `safe`/`fix` text, everything else
 * maps from a stable error code. Unknown errors are logged (name only) and reported as unexpected, never silently dropped.
 */
export type Problem = { code: string; title: string; why: string; fix: string };

type Entry = { why: string; fix: string };
const STUDIO = "Studio > Plugins";
/** Codes shared by plugins, MCP servers and the computer. A plugin's own `fix` text always wins over these. */
const BY_CODE: Record<string, Entry> = {
  NOT_BOUND: {
    why: "This bot is not allowed to use it.",
    fix: "Open the bot's settings, switch it on under Plugins & MCP, then try again.",
  },
  USE_GH: {
    why: "GitHub has no token here, so its tools are off.",
    fix: "The bot should run the gh command instead (for example gh pr list -R owner/repo). To use the GitHub tools, add a token in the plugin settings.",
  },
  TOOL_NOT_ALLOWED: {
    why: "This bot may not use that tool.",
    fix: "Open the bot's settings > Plugins & MCP and allow the tool, then ask again.",
  },
  UNKNOWN_TOOL: {
    why: "The bot asked for something this plugin cannot do.",
    fix: "Ask the bot to try again, or to tell you what it can do with this plugin.",
  },
  INVALID_ARGS: {
    why: "The bot sent a request the plugin could not understand.",
    fix: "Tell the bot exactly what you want (names, ids, text) so it can retry with the right details.",
  },
  INVALID: {
    why: "The request was not valid.",
    fix: "Tell the bot exactly what you want so it can retry with the right details.",
  },
  TIMEOUT: {
    why: "It took too long to answer.",
    fix: `Try again in a moment. If it keeps timing out, use Test connection in ${STUDIO}.`,
  },
  UNREACHABLE: {
    why: "The service could not be reached.",
    fix: `Check that it is running and that its address is right (${STUDIO} > Test connection).`,
  },
  BLOCKED_URL: {
    why: "That address is not allowed.",
    fix: "Use a public address. Private or local addresses need the administrator to enable private networks (ZETTA_ALLOW_PRIVATE_NETWORK=1).",
  },
  AUTH: {
    why: "The service rejected the saved credentials.",
    fix: `Remove the plugin in ${STUDIO} and install it again with a fresh key or token.`,
  },
  NEEDS_AUTH: {
    why: "The account is not connected.",
    fix: `Open ${STUDIO}, find the plugin and press Connect.`,
  },
  NOT_CONFIGURED: {
    why: "This is not set up on the server yet.",
    fix: "Ask the administrator to finish the server configuration for it, then try again.",
  },
  SCOPE_MISSING: {
    why: "The connected account did not grant the permission this needs.",
    fix: `Reconnect the plugin in ${STUDIO} and tick that permission.`,
  },
  SEND_DISABLED: {
    why: "Sending is switched off for this plugin.",
    fix: `Turn on sending in ${STUDIO} (the plugin's permissions), then ask the bot again.`,
  },
  MANAGE_DISABLED: {
    why: "Managing messages is switched off for this plugin.",
    fix: `Turn on managing in ${STUDIO} (the plugin's permissions), then ask the bot again.`,
  },
  NOT_ALLOWED: {
    why: "That target is not on the plugin's allowlist.",
    fix: `Add it to the allowlist in ${STUDIO}, or pick a target that is already allowed.`,
  },
  RATE_LIMITED: { why: "Too many requests in a short time.", fix: "Wait a minute and ask again." },
  TOO_LARGE: {
    why: "The answer was too large to handle.",
    fix: "Ask the bot for a smaller piece, for example fewer items or a shorter range.",
  },
  SECRET_UNAVAILABLE: {
    why: "The saved credentials can no longer be read.",
    fix: `Remove the plugin in ${STUDIO} and install it again.`,
  },
  CONNECTIONS_NOT_CONFIGURED: {
    why: "This server has nowhere to keep credentials safely.",
    fix: "Ask the administrator to set ZETTA_CONNECTION_KEY on the server.",
  },
  FAILED: {
    why: "It failed in a way the plugin could not describe.",
    fix: `Try again. If it keeps failing, use Test connection in ${STUDIO}.`,
  },
  // bot database (modules/bot-database errors carry their own text; these are the fallbacks)
  QUOTA: {
    why: "The bot's database is full.",
    fix: "Ask the bot to delete entries it no longer needs, or use Start over in the bot's settings > Database.",
  },
  DB_NOT_FOUND: {
    why: "The bot looked for a table or column it has not created yet.",
    fix: "Ask the bot to check what it has saved and try again.",
  },
  DB_FORBIDDEN: {
    why: "A bot can only use its own database.",
    fix: "Nothing to fix: ask the bot to keep to its own tables.",
  },
  DB_INVALID: {
    why: "The database refused a value.",
    fix: "Tell the bot exactly what you want saved.",
  },
  DB_DUPLICATE: {
    why: "That entry already exists.",
    fix: "Ask the bot to update the existing entry instead.",
  },
  DB_SYNTAX: {
    why: "The bot wrote a database command with a mistake in it.",
    fix: "Ask the bot to try again.",
  },
  DB_READ_ONLY: {
    why: "The bot tried to change data with a reading tool.",
    fix: "Ask the bot to save it again.",
  },
  // MCP servers
  STDIO_NOT_ALLOWED: {
    why: "That local command is not on the administrator's allowlist.",
    fix: "Ask the administrator to allow it (ZETTA_MCP_ALLOWLIST).",
  },
  // computer (browser, desktop, VM)
  UNAVAILABLE: {
    why: "The computer or browser is not available on this server.",
    fix: "Check Studio > Computer, or ask the administrator whether it is enabled.",
  },
  LIMIT: {
    why: "Too many computers are already running.",
    fix: "Stop one in Studio > Computer, then ask the bot again.",
  },
  HUMAN_IN_CONTROL: {
    why: "You are controlling the computer right now.",
    fix: "Hand control back in the chat or in Studio > Computer, then ask the bot again.",
  },
  STALE_CONTROL: {
    why: "Control of the computer changed while the bot was using it.",
    fix: "Ask the bot to try again.",
  },
  DISCONNECTED: {
    why: "The connection to the computer dropped (it was restarted or stopped).",
    fix: "Ask the bot to try again; it reconnects on its own.",
  },
  SLOW: {
    why: "The computer took too long to answer this step; it is still connected.",
    fix: "The bot can read the screen and try the step again.",
  },
  NO_ELEMENT: {
    why: "That element is not on the screen any more (the page changed or it is scrolled out of view).",
    fix: "The bot should read the screen again and pick the element from the new list.",
  },
  NOT_FOUND: {
    why: "It could not be found.",
    fix: "It may have been removed. Check Studio and ask the bot again.",
  },
  HOST_KEY_CHANGED: {
    why: "The machine showed a different host key than the one saved for it. That can mean the machine was rebuilt, or that something is pretending to be it.",
    fix: "Check with whoever runs the machine. If the change is expected, delete the machine in Studio > Computer and add it again to trust the new key.",
  },
  AUTH_FAILED: {
    why: "The machine refused the saved key or password.",
    fix: "Open Studio > Computer, replace the key or password of the machine, and check the user name.",
  },
  CANCELLED: { why: "The action was cancelled.", fix: "Ask the bot again if you still want it." },
  REVOKED: {
    why: "Access to it was taken away.",
    fix: "Open Studio > Computer and start it again.",
  },
};
/** Same code, different meaning depending on who threw it. */
const BY_SOURCE: Record<string, Entry> = {
  "McpError:FAILED": {
    why: "The MCP server could not be reached, or it rejected its credentials.",
    fix: `Use Test connection in ${STUDIO}. If the credentials changed, remove the server and add it again.`,
  },
  "McpError:TIMEOUT": {
    why: "The MCP server took too long to answer.",
    fix: `Try again. If it keeps happening, use Test connection in ${STUDIO}.`,
  },
};
const UNEXPECTED: Entry = {
  why: "Something unexpected went wrong while running it.",
  fix: "Try again. If it keeps happening, ask the administrator to check the server logs.",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Builds the explanation for one failure. `what` is the plain-language action, e.g. "Telegram: send message". */
export function explain(what: string, e: unknown): Problem {
  const code =
    typeof (e as { code?: unknown })?.code === "string"
      ? (e as { code: string }).code
      : e instanceof Error && e.message === "timeout"
        ? "TIMEOUT"
        : "ERROR";
  const known =
    BY_SOURCE[`${(e as Error | undefined)?.constructor?.name}:${code}`] ?? BY_CODE[code];
  if (!known && !(e instanceof PluginError))
    console.error(
      `tool failure: ${what} code=${code} name=${(e as Error | undefined)?.name ?? typeof e}`,
    ); // never the message: it may carry a URL or token
  const base = known ?? UNEXPECTED;
  // A plugin that wrote its own explanation knows best; the shared table only fills in what it left out.
  const why = e instanceof PluginError && e.safe !== DEFAULT_SAFE ? e.safe : base.why;
  const fix = e instanceof PluginError && e.fix ? e.fix : base.fix;
  return { code, title: `${what} didn't work`, why, fix };
}

/** What the bot is told. It must explain the problem to the user and must not retry the identical call. */
export const problemForBot = (p: Problem) =>
  `failed (${p.code}): ${p.why} To fix it the user can: ${p.fix} Explain this to the user in plain words, say what they can do, and do not repeat the identical call.`;

/** The callout the user sees: a trusted `zetta:ui` Alert (props are clipped to the catalog limits so it always validates). */
export function problemBlock(p: Problem, botName: string): string {
  const message = `${clip(p.why, 280)}\n\nWhat you can do: ${clip(p.fix, 220)}\nThen ask ${clip(botName, 40)} to try again.`;
  const spec = {
    root: "a",
    elements: {
      a: {
        type: "Alert",
        props: { title: clip(p.title, 110), message: clip(message, 600), tone: "danger" },
        children: [],
      },
    },
  };
  return `\`\`\`zetta:ui\n${JSON.stringify(spec).replace(/`/g, "'")}\n\`\`\``;
}

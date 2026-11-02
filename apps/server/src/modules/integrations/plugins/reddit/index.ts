import { PluginError, registerPlugin, type PluginDef } from "../registry";
import { disconnect, finishConnect, redirectUri, startConnect, status } from "./oauth";
import { readTools } from "./tools";
import { writeTools } from "./write";

/**
 * Reddit through Reddit's own OAuth2 web-app flow and Data API (oauth.reddit.com); no MCP. See oauth.ts for the flow and token handling.
 *
 * Gating:
 *   - every tool needs its own scope, chosen by the user at connect time and re-checked against what Reddit actually granted;
 *   - NSFW items are hidden (and NSFW posts refused) unless the user turns on `allowNsfw`; Reddit additionally hides NSFW content unless
 *     the account itself enabled "I'm over eighteen";
 *   - posting, commenting, voting, editing, saving, joining and messaging also need the `allowWrite` switch (default off), honour the
 *     optional subreddit allowlist and are rate limited (votes far more tightly; see write.ts).
 */
export const redditPlugin: PluginDef = {
  id: "reddit",
  name: "Reddit",
  icon: "reddit",
  category: "social",
  kind: "native",
  auth: "oauth",
  fields: [
    {
      key: "clientId",
      label: "App client id",
      kind: "text",
      placeholder: "a1B2c3D4e5F6g7H8i9",
      help: 'reddit.com/prefs/apps > create another app > type "web app". The id is the string under the app\'s name.',
    },
    {
      key: "clientSecret",
      label: "App secret",
      kind: "password",
      secret: true,
      help: `Use ${redirectUri()} as the app's redirect uri.`,
    },
  ],
  description:
    "Let bots read your Reddit feed, saved items, history and inbox and, if you allow it, post, comment, vote and message with your account.",
  docsUrl: "https://github.com/reddit-archive/reddit/wiki/OAuth2",
  notes:
    'Uses your own Reddit "web app", stored encrypted for your account only (Reddit may need to approve new Data API apps before they work). You choose the permissions when you connect; NSFW content and acting on your account are off unless you opt in.',
  tools: [...readTools, ...writeTools],
  async install(ctx) {
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(ctx.config.clientId ?? ""))
      throw new PluginError(
        "INVALID_FIELD",
        "That does not look like a Reddit app client id.",
        "Copy the string shown under the app's name at reddit.com/prefs/apps.",
      );
  },
  connect: startConnect,
  callback: finishConnect,
  disconnect,
  status,
};
registerPlugin(redditPlugin);

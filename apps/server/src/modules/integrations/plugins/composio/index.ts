import { registerPlugin, type PluginDef } from "../registry";
import { callback, connect, disconnect, install, status } from "./api";
import { composioTools } from "./tools";

/**
 * Composio (composio.dev): one API key, hundreds of toolkits (GitHub, Slack, Gmail, ...) with Composio-managed sign-in. Native plugin
 * with a few meta tools (search, schema, read, execute, connect) because the tool list is too large and dynamic to register one by one.
 * See api.ts for the API calls and what is stored.
 *
 * Gating:
 *   - bots can only touch toolkits the user allowed (checked on every call against the tool's own toolkit);
 *   - tools Composio does not tag read-only also need the `allowWrite` switch (default off);
 *   - a toolkit works only after the user finished its sign-in through the hosted Connect Link.
 */
export const composioPlugin: PluginDef = {
  id: "composio",
  name: "Composio",
  icon: "composio",
  category: "productivity",
  kind: "native",
  auth: "api-key",
  fields: [
    {
      key: "apiKey",
      label: "Composio API key",
      kind: "password",
      secret: true,
      help: "Create a project API key at dashboard.composio.dev > Settings. Usage counts against your Composio plan.",
    },
  ],
  description:
    "Let bots use GitHub, Slack, Gmail, Notion and hundreds of other apps through your own Composio account.",
  docsUrl: "https://docs.composio.dev/docs",
  notes:
    "Calls go through Composio, which stores the sign-in tokens of the apps you connect. Every toolkit is off until you allow it; changing data also needs Allow actions.",
  tools: composioTools,
  install,
  connect,
  callback,
  disconnect,
  status,
};
registerPlugin(composioPlugin);

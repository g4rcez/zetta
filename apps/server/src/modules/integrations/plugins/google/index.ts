import { registerPlugin, type PluginDef } from "../registry";
import { calendarTools } from "./calendar";
import { driveTools } from "./drive";
import { gmailTools } from "./gmail";
import { disconnect, finishConnect, startConnect, status } from "./oauth";

/**
 * Google (Gmail, Calendar, Drive) through Google's own OAuth 2.0 web-server flow; no MCP. See oauth.ts for the flow and token handling.
 *
 * Outward-action gating (the repo's proposal flow lives in the chat service and only covers config/creation, so plugin writes are gated here):
 *   - every write tool needs its own opt-in scope, chosen by the user at connect time and re-checked against what Google actually granted;
 *   - gmail_create_draft only creates a draft the user reviews and sends themselves;
 *   - gmail_send additionally needs the per-plugin `allowSend` switch (default off) and is rate limited;
 *   - calendar_create_event never invites guests (sendUpdates=none).
 * Note: Google's gmail.compose scope technically also permits sending drafts; Zetta never calls that, but revoke it if that matters to you.
 */
export const googlePlugin: PluginDef = {
  id: "google", name: "Google (Gmail, Calendar, Drive)", icon: "mail", category: "google", kind: "native", auth: "oauth", fields: [],
  description: "Let bots search your mail, check your calendar and read Drive documents with your own Google account.",
  docsUrl: "https://developers.google.com/identity/protocols/oauth2/web-server",
  notes: "Needs a Google Cloud OAuth client (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET on the server). You choose the permissions when you connect; writing and sending are off unless you opt in.",
  tools: [...gmailTools, ...calendarTools, ...driveTools],
  connect: startConnect, callback: finishConnect, disconnect, status,
};
registerPlugin(googlePlugin);

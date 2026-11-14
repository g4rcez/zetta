import { registerPlugin, type PluginDef, type PluginTool } from "../registry";
import { calendarTools } from "./calendar";
import { docsTools } from "./docs";
import { driveTools } from "./drive";
import { gmailTools } from "./gmail";
import { sheetsTools } from "./sheets";
import {
  API_PAGES,
  disconnect,
  finishConnect,
  grantedScopes,
  readAccounts,
  redirectUri,
  startConnect,
  status,
} from "./oauth";

/** Which Google service each permission belongs to, in the order they are listed. */
const SERVICES = [
  ["gmail", /^gmail\./],
  ["calendar", /^calendar\./],
  ["drive", /^drive\./],
  ["docs", /^documents/],
  ["sheets", /^spreadsheets/],
] as const;

const accountTools: PluginTool[] = [
  {
    name: "google_accounts",
    description:
      "List the Google accounts the user connected and what each can do (gmail, calendar, drive, docs, sheets). Use an email from this list as the `account` argument of the other Google tools.",
    effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(ctx) {
      return {
        accounts: readAccounts(ctx.config).map((a) => {
          const scopes = [...grantedScopes(a)];
          return {
            email: a.email,
            state: a.refreshToken ? "connected" : "needs-auth",
            services: a.refreshToken
              ? SERVICES.filter(([, re]) => scopes.some((s) => re.test(s))).map(([n]) => n)
              : [],
          };
        }),
      };
    },
  },
];

/**
 * Google (Gmail, Calendar, Drive, Docs, Sheets) through Google's own OAuth 2.0 web-server flow; no MCP. The user may connect several Google
 * accounts; every tool takes an optional `account` (email). See oauth.ts for the flow, the account model and token handling.
 *
 * Outward-action gating (the repo's proposal flow lives in the chat service and only covers config/creation, so plugin writes are gated here):
 *   - every write tool needs its own opt-in scope, chosen by the user at connect time and re-checked against what Google actually granted;
 *   - gmail_create_draft only creates a draft the user reviews and sends themselves;
 *   - gmail_send additionally needs the per-account `allowSend` switch (default off) and is rate limited;
 *   - calendar_create_event never invites guests (sendUpdates=none).
 * Note: Google's gmail.compose scope technically also permits sending drafts; Zetta never calls that, but revoke it if that matters to you.
 */
export const googlePlugin: PluginDef = {
  id: "google",
  name: "Google (Gmail, Calendar, Drive, Docs, Sheets)",
  icon: "mail",
  category: "google",
  kind: "native",
  auth: "oauth",
  fields: [
    {
      key: "clientId",
      label: "OAuth client ID",
      kind: "text",
      optional: true,
      placeholder: "1234-abc.apps.googleusercontent.com",
      help: 'Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID, of type "Desktop app" (or "Web application", see Client type).',
    },
    {
      key: "clientSecret",
      label: "OAuth client secret",
      kind: "password",
      secret: true,
      optional: true,
      help: `For a Web application client, add ${redirectUri()} as an authorised redirect URI of that client. A Desktop app client needs no redirect URI.`,
    },
    {
      key: "clientType",
      label: "Client type",
      kind: "select",
      optional: true,
      options: [
        {
          value: "desktop",
          label:
            "Desktop app: works from any address (LAN IP, .local, localhost); you paste the final address back",
        },
        {
          value: "web",
          label: "Web application: needs a public https domain as the redirect URI",
        },
      ],
      help: "Must match the type of the OAuth client you created. Google refuses a Web application redirect on a LAN IP or .local, so use Desktop app there.",
    },
  ],
  description:
    "Let bots search your mail, check your calendar, read Drive files and work with Docs and Sheets using your own Google accounts.",
  docsUrl: "https://developers.google.com/identity/protocols/oauth2/web-server",
  notes:
    "Uses your own Google Cloud OAuth client, stored encrypted for your account only. You can connect several Google accounts and choose the permissions of each; writing and sending are off unless you opt in.",
  guide: () => [
    "Open https://console.cloud.google.com/ and create a project (or pick one).",
    `In APIs & Services > Library, press Enable on each API you want bots to use (a service whose API is off fails with an "API is not enabled" error): ${API_PAGES.map((p) => `${p.name} ${p.url}`).join(", ")}.`,
    "Configure the OAuth consent screen and add your own Google accounts as test users.",
    `Create an OAuth client ID of type "Desktop app" (works from any address, no redirect URI to register). Only if Zetta has a public https domain, a "Web application" client with ${redirectUri()} as an authorised redirect URI also works.`,
    "Paste the client ID and client secret in the setup card and choose the matching Client type. With Desktop app, Google ends on a page that does not load: copy that page's address and paste it back in Zetta to finish.",
    "Tick the permissions you want for the account, then sign in with Google. Repeat for each account. To add a permission later, use Change permissions on that account and sign in again.",
  ],
  tools: [
    ...accountTools,
    ...gmailTools,
    ...calendarTools,
    ...driveTools,
    ...docsTools,
    ...sheetsTools,
  ],
  connect: startConnect,
  callback: finishConnect,
  disconnect,
  status,
};
registerPlugin(googlePlugin);

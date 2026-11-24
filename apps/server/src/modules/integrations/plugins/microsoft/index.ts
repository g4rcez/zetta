import { registerPlugin, type PluginDef, type PluginTool } from "../registry";
import {
  disconnect,
  finishConnect,
  grantedScopes,
  readAccounts,
  redirectUri,
  startConnect,
  status,
} from "./oauth";

const accountTools: PluginTool[] = [
  {
    name: "microsoft_accounts",
    description:
      "List the Microsoft accounts (Outlook.com, Microsoft 365) the user connected and whether each can still sign in. Mail is read and sent through the mailbox tools, not here.",
    effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(ctx) {
      return {
        accounts: readAccounts(ctx.config).map((a) => ({
          email: a.email,
          state: a.refreshToken ? "connected" : "needs-auth",
          permissions: a.refreshToken ? [...grantedScopes(a)] : [],
        })),
      };
    },
  },
];

/**
 * Microsoft (Outlook.com and Microsoft 365 mail) through the Microsoft identity platform's own OAuth 2.0 flow; no MCP. Microsoft turned off
 * password sign-in for IMAP and SMTP, so a Microsoft address is read through Microsoft Graph with the person's own app registration. The
 * accounts become mailboxes (modules/mail/drivers/microsoft.ts); the plugin has no mail tools of its own. See oauth.ts for the flow.
 *
 * Reading needs Mail.Read. Sending needs Mail.Send and is off for a new mailbox until the person turns it on in the mailbox settings.
 * Zetta asks for no permission that can change or delete mail (no Mail.ReadWrite).
 */
export const microsoftPlugin: PluginDef = {
  id: "microsoft",
  name: "Microsoft (Outlook, Microsoft 365 mail)",
  icon: "mail",
  category: "productivity",
  kind: "native",
  auth: "oauth",
  fields: [
    {
      key: "clientId",
      label: "Application (client) ID",
      kind: "text",
      optional: true,
      placeholder: "00000000-0000-0000-0000-000000000000",
      help: "Microsoft Entra admin center > App registrations > your app > Overview > Application (client) ID.",
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
            "Public client (Mobile and desktop): no secret; works from any address, you paste the final address back",
        },
        {
          value: "web",
          label: "Web: a client secret and a public https redirect URI",
        },
      ],
      help: "Must match the platform you added to the app registration.",
    },
    {
      key: "clientSecret",
      label: "Client secret value",
      kind: "password",
      secret: true,
      optional: true,
      help: `Only for the Web type. Add ${redirectUri()} as a Web redirect URI. A public client has no secret: leave this empty.`,
    },
    {
      key: "tenant",
      label: "Tenant",
      kind: "text",
      optional: true,
      placeholder: "common",
      help: "Leave empty (common) for work, school and personal accounts. Enter a tenant ID or domain only if the app registration is single-tenant.",
    },
  ],
  description:
    "Let Zetta read and answer the mail of your Outlook.com or Microsoft 365 accounts, using your own Microsoft Entra app registration.",
  docsUrl: "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow",
  notes:
    "Uses your own app registration, stored encrypted for your account only. You can connect several accounts. Zetta asks to read mail, and to send mail when you tick it; it never asks to change or delete mail.",
  guide: () => [
    "Open https://entra.microsoft.com and go to Entra ID > App registrations > New registration.",
    'Name it (for example "Zetta mail"). Under Supported account types choose "Accounts in any organizational directory and personal Microsoft accounts" so Outlook.com and work accounts both work (a single-tenant registration only works for that organization: then enter its tenant ID in Tenant).',
    `Redirect URI: for a public client choose the platform "Mobile and desktop applications" and add http://localhost (Microsoft ignores the port). For a web client choose "Web" and add ${redirectUri()} (a public https domain), then create a client secret under Certificates & secrets and copy its Value (not the Secret ID).`,
    'Under Authentication, for a public client turn on "Allow public client flows" (Advanced settings).',
    "Under API permissions > Add a permission > Microsoft Graph > Delegated permissions, add Mail.Read, Mail.Send and User.Read (offline_access is added by the sign-in). Do not add Mail.ReadWrite.",
    "In a work or school tenant where users may not consent to apps, an administrator must press Grant admin consent for the tenant on that page (or the sign-in asks for approval).",
    "Paste the Application (client) ID in the setup card (and the secret for a web client), choose the matching Client type, tick Read mail (and Send mail if wanted), then sign in with Microsoft.",
    "With a public client the sign-in ends on a page that does not load (localhost): copy that page's whole address and paste it back in Zetta to finish. Repeat for each account.",
    "To remove access, disconnect the account here and remove the app at https://myaccount.microsoft.com/ (work or school) or https://account.live.com/consent/Manage (personal): Microsoft has no way for Zetta to revoke a token itself.",
  ],
  tools: accountTools,
  connect: startConnect,
  callback: finishConnect,
  disconnect,
  status,
};
registerPlugin(microsoftPlugin);

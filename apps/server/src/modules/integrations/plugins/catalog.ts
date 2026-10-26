import { registerPlugin, type PluginDef, type PluginField } from "./registry";

/**
 * Catalog of installable MCP servers (data). Endpoints and commands were checked against each vendor's official documentation;
 * `verified: false` marks anything that could not be confirmed. Stdio entries are the ONLY local commands that may ever be started:
 * `catalogStdio()` feeds the MCP allowlist, so the browser can pick an entry but never supply a command or arguments.
 */
const token = (label: string, help: string, placeholder?: string, optional?: boolean): PluginField[] => [{ key: "token", label, secret: true, kind: "password", help, placeholder, optional }];
const remote = (d: Omit<PluginDef, "kind" | "mcp" | "auth" | "fields"> & { url: string; fields?: PluginField[]; auth?: PluginDef["auth"] }): PluginDef => {
  const { url, fields = [], auth = fields.length ? "api-key" : "none", ...rest } = d;
  return { ...rest, kind: "mcp", auth, fields, mcp: { transport: "http", url, secretField: fields.find((f) => f.secret)?.key } };
};
const local = (d: Omit<PluginDef, "kind" | "mcp" | "auth" | "fields"> & { command: string; args: string[] }): PluginDef => {
  const { command, args, ...rest } = d;
  return { ...rest, kind: "mcp", auth: "none", fields: [], mcp: { transport: "stdio", command, args } };
};

export const CATALOG: PluginDef[] = [
  remote({ id: "sentry", name: "Sentry", description: "Search issues, events and releases in your Sentry organisation.", icon: "bug", category: "monitoring", url: "https://mcp.sentry.dev/mcp",
    docsUrl: "https://mcp.sentry.dev/", verified: false, notes: "The endpoint is official, but Sentry documents OAuth only; using a user auth token as a bearer token is unconfirmed.",
    fields: token("Sentry user auth token", "Create a token at sentry.io/settings/account/api/auth-tokens with read scopes.", "sntryu_...") }),
  remote({ id: "posthog", name: "PostHog", description: "Query product analytics, flags and experiments.", icon: "chart-line", category: "analytics", url: "https://mcp.posthog.com/mcp",
    docsUrl: "https://posthog.com/docs/model-context-protocol", fields: token("Personal API key", "Create one with the MCP Server preset at app.posthog.com/settings/user-api-keys.", "phx_...") }),
  remote({ id: "cloudflare", name: "Cloudflare API", description: "Manage Cloudflare accounts, Workers, DNS and more through the API MCP server.", icon: "cloud", category: "cloud", url: "https://mcp.cloudflare.com/mcp",
    docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/", fields: token("API token", "Create a user or account API token with only the permissions the bot needs.") }),
  remote({ id: "cloudflare-docs", name: "Cloudflare Docs", description: "Search the Cloudflare documentation.", icon: "book-open", category: "docs", url: "https://docs.mcp.cloudflare.com/mcp",
    docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/", verified: false, notes: "Listed as OAuth in the docs; anonymous access is unconfirmed, so it may fail to connect." }),
  remote({ id: "github", name: "GitHub", description: "Read repositories, issues, pull requests and code search.", icon: "github", category: "dev", url: "https://api.githubcopilot.com/mcp/",
    docsUrl: "https://github.com/github/github-mcp-server", fields: token("Personal access token", "Use a fine-grained token scoped to the repositories the bot may touch.", "github_pat_...") }),
  remote({ id: "linear", name: "Linear", description: "Find and update Linear issues, projects and cycles.", icon: "list-checks", category: "productivity", url: "https://mcp.linear.app/mcp",
    docsUrl: "https://linear.app/docs/mcp", fields: token("API key", "Create a personal API key in Linear settings (Read-only permission is enough for browsing).", "lin_api_...") }),
  remote({ id: "notion", name: "Notion", description: "Search and edit Notion pages and databases.", icon: "notebook", category: "productivity", url: "https://mcp.notion.com/mcp",
    docsUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp", notes: "Bearer MCP tokens are available on Business and Enterprise plans (Developer portal > New MCP token).",
    fields: token("MCP token", "Workspace owners create it in the Notion Developer portal.") }),
  remote({ id: "context7", name: "Context7", description: "Up-to-date library documentation for coding bots.", icon: "library", category: "docs", url: "https://mcp.context7.com/mcp",
    docsUrl: "https://github.com/upstash/context7", fields: token("API key (optional)", "A free key from context7.com/dashboard raises rate limits.", "ctx7sk-...", true) }),
  local({ id: "playwright", name: "Playwright", description: "A headless browser the bot can drive (runs on the Zetta server).", icon: "globe", category: "browser", command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"],
    docsUrl: "https://github.com/microsoft/playwright-mcp", notes: "Runs locally through npx on the server; the first call downloads the package." }),
  local({ id: "chrome-devtools", name: "Chrome DevTools", description: "Inspect pages, performance and the console with a headless Chrome.", icon: "bug-play", category: "browser", command: "npx", args: ["-y", "chrome-devtools-mcp@latest", "--headless"],
    docsUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp", verified: false, notes: "The command is official; the --headless flag is listed as a server parameter but its behaviour is unconfirmed." }),
];

/** Complete argv of every local command a catalog entry may run (merged into the MCP stdio allowlist). */
export const catalogStdio = () => CATALOG.flatMap((d) => (d.mcp?.transport === "stdio" ? [{ command: d.mcp.command, args: d.mcp.args }] : []));
for (const d of CATALOG) registerPlugin(d);

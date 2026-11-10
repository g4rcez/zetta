import { PluginError, type PluginContext, type PluginTool } from "../registry";
import { obj, str, untrustedDoc, untrustedList } from "../untrusted";
import {
  allowedToolkits,
  cfetch,
  connect,
  ensureSession,
  needAllowed,
  toolInfo,
  toolkitSlug,
  toolkitStates,
  toolSlug,
  toToolInfo,
  writesAllowed,
} from "./api";

const MAX_ARGS = 20_000;
const SETTINGS_HINT = "Open Studio > Plugins > Composio.";

const NOT_CONNECTED = (toolkit: string) =>
  new PluginError(
    "NEEDS_AUTH",
    `${toolkit} is not connected to Composio yet.`,
    `Connect it in ${SETTINGS_HINT}, or ask the bot for a connect link.`,
  );

/** Runs one tool through the user's session. `readOnly` is composio_read: it refuses anything Composio does not tag as read-only. */
async function run(
  ctx: PluginContext,
  a: Record<string, unknown>,
  readOnly: boolean,
): Promise<string> {
  const slug = toolSlug(a.tool);
  const info = await toolInfo(ctx, slug);
  needAllowed(ctx, info.toolkit);
  if (readOnly && !info.readOnly)
    throw new PluginError(
      "NOT_READ_ONLY",
      `${slug} may change something, so it cannot run as a read.`,
      "Use composio_execute for it. That needs Allow actions in Studio > Plugins > Composio.",
    );
  if (!info.readOnly && !writesAllowed(ctx))
    throw new PluginError(
      "WRITE_DISABLED",
      "Acting through Composio is switched off for this plugin.",
      `${SETTINGS_HINT} Turn on 'Allow bots to act on my accounts', press Save, then ask again.`,
    );
  const args = a.arguments ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args))
    throw new PluginError("INVALID_ARGS", "arguments must be an object.");
  if (JSON.stringify(args).length > MAX_ARGS)
    throw new PluginError("INVALID_ARGS", "arguments are too large.");
  const session = await ensureSession(ctx);
  const src = `Composio (${info.toolkit})`;
  let r: Record<string, unknown>;
  try {
    r = await cfetch(ctx, `/tool_router/session/${session}/execute`, {
      method: "POST",
      body: { tool_slug: slug, arguments: args },
    });
  } catch (e) {
    if (e instanceof PluginError && e.code === "COMPOSIO_REJECTED") {
      const state = (await toolkitStates(ctx).catch(() => [])).find((t) => t.slug === info.toolkit);
      if (state && !state.connected) throw NOT_CONNECTED(info.toolkit);
    }
    throw e;
  }
  if (r.result_type === "completed")
    return untrustedDoc(src, { tool: slug }, JSON.stringify(r.data ?? {}));
  if (r.result_type === "failed") {
    const state = (await toolkitStates(ctx).catch(() => [])).find((t) => t.slug === info.toolkit);
    if (state && !state.connected) throw NOT_CONNECTED(info.toolkit);
    return untrustedDoc(
      src,
      { tool: slug, result: "failed" },
      str(r.error, 2000) || "The tool failed.",
    );
  }
  if (r.result_type === "blocked")
    throw new PluginError(
      "BLOCKED",
      "Composio blocked that call.",
      "Check the session rules in the Composio dashboard.",
    );
  throw new PluginError(
    "INPUT_REQUIRED",
    "Composio asks for an approval that Zetta cannot show.",
    "Run that action in the Composio dashboard instead.",
  );
}

export const composioTools: PluginTool[] = [
  {
    name: "composio_toolkits",
    description:
      "The toolkits the user allowed through Composio (for example github, slack) and whether each is connected.",
    effect: "read",
    inputSchema: obj({}),
    async handler(ctx) {
      return {
        toolkits: (await toolkitStates(ctx)).map(({ slug, name, connected }) => ({
          slug,
          name,
          connected,
        })),
      };
    },
  },
  {
    name: "composio_search",
    description:
      "Find Composio tools by what you want to do, inside the allowed toolkits. Returns tool slugs, whether each only reads, and a short description. Untrusted data.",
    effect: "read",
    inputSchema: obj(
      {
        query: { type: "string", description: "What to do, e.g. list open pull requests" },
        toolkit: { type: "string", description: "Optional: search only this toolkit slug" },
      },
      ["query"],
    ),
    async handler(ctx, a) {
      const query = str(a.query, 200);
      if (!query) throw new PluginError("INVALID_ARGS", "query is empty.");
      const allowed = allowedToolkits(ctx.config);
      if (!allowed.length)
        throw new PluginError(
          "NOT_CONFIGURED",
          "No Composio toolkit is allowed yet.",
          `Pick toolkits in ${SETTINGS_HINT}`,
        );
      const only = a.toolkit ? toolkitSlug(a.toolkit) : undefined;
      if (only) needAllowed(ctx, only);
      const r = await cfetch(ctx, "/tools", {
        query: { query, toolkit_slug: (only ? [only] : allowed).join(","), limit: "10" },
      });
      const found = (Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [])
        .map(toToolInfo)
        .filter((t) => allowed.includes(t.toolkit))
        .map((t) => ({
          tool: t.slug,
          toolkit: t.toolkit,
          readOnly: t.readOnly || undefined,
          description: t.description.slice(0, 200),
        }));
      return untrustedList("Composio", "tools", found);
    },
  },
  {
    name: "composio_tool_schema",
    description:
      "The input schema of one Composio tool, so you can build its arguments. Untrusted data.",
    effect: "read",
    inputSchema: obj(
      { tool: { type: "string", description: "Tool slug, e.g. GITHUB_GET_A_REPOSITORY" } },
      ["tool"],
    ),
    async handler(ctx, a) {
      const info = await toolInfo(ctx, toolSlug(a.tool));
      needAllowed(ctx, info.toolkit);
      return untrustedDoc(
        `Composio (${info.toolkit})`,
        {
          tool: info.slug,
          toolkit: info.toolkit,
          readOnly: String(info.readOnly),
          description: info.description,
        },
        JSON.stringify(info.input ?? {}),
      );
    },
  },
  {
    name: "composio_read",
    description:
      "Run a Composio tool that only reads (Composio tags it read-only) in an allowed, connected toolkit. Refuses anything that could change data. Untrusted data.",
    effect: "read",
    inputSchema: obj(
      {
        tool: { type: "string", description: "Tool slug from composio_search" },
        arguments: {
          type: "object",
          description: "Arguments as described by composio_tool_schema",
        },
      },
      ["tool"],
    ),
    handler: (ctx, a) => run(ctx, a, true),
  },
  {
    name: "composio_execute",
    description:
      "Run any Composio tool in an allowed, connected toolkit, including ones that send, post, create or delete. Tools that are not read-only need the user's Allow actions switch. Untrusted data.",
    effect: "write",
    inputSchema: obj(
      {
        tool: { type: "string", description: "Tool slug from composio_search" },
        arguments: {
          type: "object",
          description: "Arguments as described by composio_tool_schema",
        },
      },
      ["tool"],
    ),
    handler: (ctx, a) => run(ctx, a, false),
  },
  {
    name: "composio_connect",
    description:
      "Get a link the user opens to connect their account for an allowed toolkit that is not connected yet. Give the link to the user.",
    effect: "write",
    inputSchema: obj({ toolkit: { type: "string", description: "Toolkit slug, e.g. github" } }, [
      "toolkit",
    ]),
    async handler(ctx, a) {
      const toolkit = toolkitSlug(a.toolkit);
      needAllowed(ctx, toolkit);
      if ((await toolkitStates(ctx)).find((t) => t.slug === toolkit)?.connected)
        return { toolkit, connected: true };
      const { authorizeUrl } = await connect(ctx, { action: "link", toolkit });
      return {
        toolkit,
        connected: false,
        link: authorizeUrl,
        note: "The link expires in 10 minutes. The user must be signed in to Zetta in that browser.",
      };
    },
  },
];

import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { id, optStr, rest } from "./rest";

/**
 * Vercel through its REST API with the person's access token (https://vercel.com/docs/rest-api). Reads projects, deployments, build
 * logs and domains; lists environment variable NAMES only (never values); redeploys on request. Base address is fixed.
 */
const API = "https://api.vercel.com";
const keyHint = "Create a new token at vercel.com/account/tokens and update the plugin.";
function call(
  c: PluginContext,
  path: string,
  init: {
    method?: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string | undefined>;
  } = {},
) {
  const token = (c.config.token ?? "").trim();
  if (!token)
    throw new PluginError(
      "NOT_CONFIGURED",
      "Vercel has no access token.",
      "Open the plugin and paste a token.",
    );
  const q = new URLSearchParams();
  const team = (c.config.teamId ?? "").trim();
  if (team) q.set("teamId", team);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) q.set(k, v);
  return rest({
    service: "Vercel",
    url: `${API}${path}${q.size ? `?${q}` : ""}`,
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
    body: init.body,
    keyHint,
  });
}
type Deployment = {
  uid: string;
  name: string;
  url?: string;
  state?: string;
  readyState?: string;
  created?: number;
  target?: string | null;
};
const dep = (d: Deployment) => ({
  id: d.uid,
  project: d.name,
  url: d.url ? `https://${d.url}` : undefined,
  state: d.state ?? d.readyState,
  target: d.target ?? "preview",
  createdAt: d.created ? new Date(d.created).toISOString() : undefined,
});

export const vercelPlugin: PluginDef = registerPlugin({
  id: "vercel",
  name: "Vercel",
  description: "See projects, deployments, build logs and domains; redeploy when you ask.",
  icon: "triangle",
  category: "cloud",
  auth: "api-key",
  docsUrl: "https://vercel.com/docs/rest-api",
  fields: [
    {
      key: "token",
      label: "Access token",
      secret: true,
      kind: "password",
      help: "vercel.com/account/tokens",
    },
    {
      key: "teamId",
      label: "Team id",
      optional: true,
      help: "Only for a team account (Settings > General > Team ID).",
    },
  ],
  guide: () => [
    "Open vercel.com/account/tokens and create a token with the scope of your account or team.",
    "Paste it here; add the team id for a team.",
  ],
  kind: "native",
  async status(c) {
    const u = (await call(c, "/v2/user")) as { user?: { username?: string } };
    return { state: "connected", info: { account: u.user?.username } };
  },
  tools: [
    {
      name: "projects",
      description: "Your projects: id, name, framework.",
      effect: "read",
      inputSchema: { type: "object", properties: {} },
      handler: async (c) =>
        (
          (await call(c, "/v9/projects", { query: { limit: "50" } })) as {
            projects?: { id: string; name: string; framework?: string }[];
          }
        ).projects?.map((p) => ({ id: p.id, name: p.name, framework: p.framework })) ?? [],
    },
    {
      name: "deployments",
      description: "Recent deployments, optionally of one project.",
      effect: "read",
      inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
      handler: async (c, a) =>
        (
          (await call(c, "/v6/deployments", {
            query: { limit: "20", projectId: optStr(a, "projectId", 128) },
          })) as {
            deployments?: Deployment[];
          }
        ).deployments?.map(dep) ?? [],
    },
    {
      name: "build_logs",
      description: "The build log of one deployment (last lines).",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { deploymentId: { type: "string" } },
        required: ["deploymentId"],
      },
      handler: async (c, a) => {
        const events = (await call(c, `/v3/deployments/${id(a, "deploymentId")}/events`, {
          query: { limit: "200" },
        })) as {
          text?: string;
          payload?: { text?: string };
        }[];
        return (Array.isArray(events) ? events : [])
          .map((e) => e.text ?? e.payload?.text ?? "")
          .filter(Boolean)
          .slice(-120)
          .join("\n");
      },
    },
    {
      name: "domains",
      description: "The domains of a project.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      handler: async (c, a) =>
        (
          (await call(c, `/v9/projects/${id(a, "projectId")}/domains`)) as {
            domains?: { name: string; verified?: boolean }[];
          }
        ).domains?.map((d) => ({ name: d.name, verified: d.verified })) ?? [],
    },
    {
      name: "env_names",
      description:
        "The names and targets of a project's environment variables. Values are never returned.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      handler: async (c, a) =>
        (
          (await call(c, `/v9/projects/${id(a, "projectId")}/env`)) as {
            envs?: { key: string; target?: string[] }[];
          }
        ).envs?.map((e) => ({ name: e.key, targets: e.target })) ?? [],
    },
    {
      name: "redeploy",
      description:
        "Deploy again from an existing deployment (same commit and settings). Target production only when the user asked for it.",
      inputSchema: {
        type: "object",
        properties: {
          deploymentId: { type: "string" },
          project: { type: "string" },
          target: { type: "string", enum: ["production", "preview"] },
        },
        required: ["deploymentId", "project"],
      },
      handler: async (c, a) =>
        dep(
          (await call(c, "/v13/deployments", {
            method: "POST",
            body: {
              name: optStr(a, "project", 100),
              deploymentId: id(a, "deploymentId"),
              ...(a.target === "production" ? { target: "production" } : {}),
            },
          })) as Deployment,
        ),
    },
  ],
});

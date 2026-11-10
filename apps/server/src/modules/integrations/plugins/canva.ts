import {
  accessToken,
  disconnectOAuth,
  finishOAuth,
  startOAuth,
  type OAuthProvider,
} from "./oauth2";
import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { saveOutput } from "./outputs";
import { id, optStr, rest, str } from "./rest";

/**
 * Canva through the Connect API (https://www.canva.dev/docs/connect/) with the person's own Canva integration (OAuth 2 + PKCE). Lists
 * and searches designs, creates a design, and exports one to a file kept in the person's code folder (outputs/canva/).
 */
const API = "https://api.canva.com/rest/v1";
export const CANVA: OAuthProvider = {
  id: "canva",
  service: "Canva",
  authUrl: "https://www.canva.com/api/oauth/authorize",
  tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
  scopes: [
    "profile:read",
    "design:meta:read",
    "design:content:read",
    "design:content:write",
    "asset:read",
  ],
  basicAuth: true,
};
const keyHint = "Open the Canva plugin and connect again.";
async function call(
  c: PluginContext,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
) {
  return rest({
    service: "Canva",
    url: `${API}${path}`,
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken(CANVA, c)}` },
    body: init.body,
    keyHint,
  });
}
type Design = {
  id: string;
  title?: string;
  urls?: { edit_url?: string; view_url?: string };
  updated_at?: number;
};
const design = (d: Design) => ({
  id: d.id,
  title: d.title ?? "(untitled)",
  edit: d.urls?.edit_url,
  updatedAt: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : undefined,
});
const PRESETS = ["doc", "whiteboard", "presentation"] as const;
const FORMATS = ["pdf", "png", "jpg"] as const;

export const canvaPlugin: PluginDef = registerPlugin({
  id: "canva",
  name: "Canva",
  description: "Find your designs, start new ones and export them as PDF or images.",
  icon: "palette",
  category: "productivity",
  auth: "oauth",
  docsUrl: "https://www.canva.dev/docs/connect/",
  fields: [
    {
      key: "clientId",
      label: "Client ID",
      kind: "text",
      help: "From your integration at canva.com/developers.",
    },
    { key: "clientSecret", label: "Client secret", secret: true, kind: "password" },
  ],
  guide: () => [
    "Open canva.com/developers/integrations and create an integration.",
    `Add ${`<your Zetta address>/api/plugins/canva/callback`} as a redirect URL, and turn on the design and profile scopes.`,
    "Paste the client ID and secret here, then click Connect.",
  ],
  kind: "native",
  connect: (c) => startOAuth(CANVA, c),
  callback: (c, params) => finishOAuth(CANVA, c, params),
  disconnect: (c) => disconnectOAuth(c),
  async status(c) {
    if (!c.config.accessToken) return { state: "needs-auth" };
    const me = (await call(c, "/users/me/profile")) as { profile?: { display_name?: string } };
    return { state: "connected", info: { account: me.profile?.display_name } };
  },
  tools: [
    {
      name: "designs",
      description: "Your designs, newest first, optionally matching words.",
      effect: "read",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      handler: async (c, a) => {
        const q = optStr(a, "query", 200);
        const r = (await call(
          c,
          `/designs?${new URLSearchParams({ ...(q ? { query: q } : {}), sort_by: "modified_descending" })}`,
        )) as {
          items?: Design[];
        };
        return (r.items ?? []).slice(0, 30).map(design);
      },
    },
    {
      name: "create_design",
      description:
        "Start a new design (doc, whiteboard or presentation) with a title. Returns its edit link.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, type: { type: "string", enum: [...PRESETS] } },
        required: ["title"],
      },
      handler: async (c, a) => {
        const type = PRESETS.includes(a.type as never) ? (a.type as string) : "doc";
        const r = (await call(c, "/designs", {
          method: "POST",
          body: { design_type: { type: "preset", name: type }, title: str(a, "title", 255) },
        })) as { design?: Design };
        if (!r.design)
          throw new PluginError("SERVICE_ERROR", "Canva did not return the new design.");
        return design(r.design);
      },
    },
    {
      name: "export",
      description:
        "Export a design as pdf, png or jpg into the user's code folder. Returns the saved path.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          format: { type: "string", enum: [...FORMATS] },
        },
        required: ["designId"],
      },
      handler: async (c, a) => {
        const format = FORMATS.includes(a.format as never) ? (a.format as string) : "pdf";
        const designId = id(a, "designId");
        const job = (await call(c, "/exports", {
          method: "POST",
          body: { design_id: designId, format: { type: format } },
        })) as {
          job?: { id: string };
        };
        if (!job.job?.id) throw new PluginError("SERVICE_ERROR", "Canva did not start the export.");
        for (let i = 0; i < 30; i++) {
          await Bun.sleep(2000);
          const r = (await call(c, `/exports/${encodeURIComponent(job.job.id)}`)) as {
            job?: { status?: string; urls?: string[]; error?: { message?: string } };
          };
          if (r.job?.status === "failed")
            throw new PluginError(
              "SERVICE_ERROR",
              `Canva could not export: ${r.job.error?.message ?? "failed"}.`,
            );
          const url = r.job?.urls?.[0];
          if (r.job?.status === "success" && url) {
            // The download link is a signed address on Canva's own storage.
            if (!/^https:\/\/[^/]*canva/.test(new URL(url).origin))
              throw new PluginError("SERVICE_ERROR", "Canva sent an unexpected link.");
            const bytes = new Uint8Array(
              await (
                await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) })
              ).arrayBuffer(),
            );
            return {
              saved: await saveOutput(c.userId, "canva", `${designId}.${format}`, bytes),
              bytes: bytes.byteLength,
            };
          }
        }
        throw new PluginError("TIMEOUT", "The export is taking too long. Try again later.");
      },
    },
  ],
});

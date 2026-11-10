import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { id, rest, str } from "./rest";

/**
 * Supabase through the Management API with the person's personal access token (https://supabase.com/docs/reference/api). Lists
 * projects, reads a project's tables and runs SQL. SQL is read-only unless the person turns on "Allow writes": a statement that is not
 * a single SELECT / WITH / EXPLAIN / SHOW is refused before it is sent. Base address is fixed.
 */
const API = "https://api.supabase.com/v1";
const keyHint =
  "Create a new token at supabase.com/dashboard/account/tokens and update the plugin.";
const call = (
  c: PluginContext,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<Record<string, unknown> | unknown[]> => {
  const token = (c.config.token ?? "").trim();
  if (!token)
    throw new PluginError(
      "NOT_CONFIGURED",
      "Supabase has no access token.",
      "Open the plugin and paste a token.",
    );
  return rest({
    service: "Supabase",
    url: `${API}${path}`,
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
    body: init.body,
    keyHint,
  }) as Promise<Record<string, unknown> | unknown[]>;
};

/** True for one statement that only reads. Comments are stripped first; a semicolon inside is refused (no stacked statements). */
export function readOnlySql(sql: string) {
  const s = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;\s*$/, "");
  if (!s || s.includes(";")) return false;
  if (!/^(select|with|explain|show)\b/i.test(s)) return false;
  return !/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|refresh|lock|comment)\b/i.test(
    s,
  );
}

export const supabasePlugin: PluginDef = registerPlugin({
  id: "supabase",
  name: "Supabase",
  description: "See your projects and tables and run SQL (read-only unless you allow writes).",
  icon: "database",
  category: "cloud",
  auth: "api-key",
  docsUrl: "https://supabase.com/docs/reference/api/introduction",
  fields: [
    {
      key: "token",
      label: "Personal access token",
      secret: true,
      kind: "password",
      help: "supabase.com/dashboard/account/tokens",
    },
    {
      key: "writes",
      label: "SQL writes",
      kind: "select",
      optional: true,
      options: [
        { value: "off", label: "Read only (default)" },
        { value: "on", label: "Allow writes" },
      ],
    },
  ],
  guide: () => [
    "Open supabase.com/dashboard/account/tokens and generate a token.",
    "Paste it here. Leave SQL writes off unless bots must change data.",
  ],
  kind: "native",
  async status(c) {
    const p = (await call(c, "/projects")) as unknown[];
    return { state: "connected", info: { projects: Array.isArray(p) ? p.length : 0 } };
  },
  tools: [
    {
      name: "projects",
      description: "Your projects: ref, name, region, status.",
      effect: "read",
      inputSchema: { type: "object", properties: {} },
      handler: async (c) =>
        (
          (await call(c, "/projects")) as unknown as {
            id: string;
            name: string;
            region?: string;
            status?: string;
          }[]
        ).map((p) => ({
          ref: p.id,
          name: p.name,
          region: p.region,
          status: p.status,
        })),
    },
    {
      name: "tables",
      description: "The tables of a project's public schema with their columns.",
      effect: "read",
      inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
      handler: async (c, a) =>
        call(c, `/projects/${id(a, "ref")}/database/query`, {
          method: "POST",
          body: {
            query:
              "select table_name, string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as columns from information_schema.columns where table_schema = 'public' group by table_name order by table_name",
          },
        }),
    },
    {
      name: "sql",
      description:
        "Run one SQL statement on a project. Read-only unless the user allowed writes in the plugin settings.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" }, query: { type: "string" } },
        required: ["ref", "query"],
      },
      handler: async (c, a) => {
        const query = str(a, "query", 20_000);
        if (c.config.writes !== "on" && !readOnlySql(query))
          throw new PluginError(
            "READ_ONLY",
            "Only one read-only statement (SELECT, WITH, EXPLAIN, SHOW) is allowed.",
            "Turn on SQL writes in the Supabase plugin settings if bots must change data.",
          );
        return call(c, `/projects/${id(a, "ref")}/database/query`, {
          method: "POST",
          body: { query },
        });
      },
    },
  ],
});

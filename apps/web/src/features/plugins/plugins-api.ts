import { useCallback, useEffect, useState } from "react";

import { call, errorMessage } from "../chat/chat-client";

export type PluginField = { key: string; label: string; secret?: boolean; optional?: boolean; kind?: "text" | "password" | "url" | "textarea"; placeholder?: string; help?: string };
export type PluginMeta = {
  id: string; name: string; description: string; icon: string; category: string; auth: "none" | "api-key" | "oauth"; kind: "mcp" | "native"; transport: "http" | "stdio" | null; fields: PluginField[];
  docsUrl: string | null; verified: boolean; notes: string | null; credentials: boolean; tools: { name: string; description: string }[];
};
export type InstalledPlugin = { id: string; serverId: string; hasSecret: boolean };
export type PluginTest = { status: { state: "connected" | "needs-auth" | "error"; detail?: string; info?: Record<string, unknown> }; tools: { name: string; description: string }[] };

export const CATEGORY_LABEL: Record<string, string> = { monitoring: "Monitoring", analytics: "Analytics", cloud: "Cloud", dev: "Development", productivity: "Productivity", docs: "Docs", browser: "Browser", messaging: "Messaging", social: "Social", google: "Google", security: "Passwords", other: "Other" };

export const pluginsApi = {
  catalog: () => call<{ plugins: PluginMeta[] }>("/api/plugins/catalog").then((r) => r.plugins),
  installed: () => call<{ plugins: InstalledPlugin[] }>("/api/plugins").then((r) => r.plugins),
  install: (id: string, config: Record<string, string>, botIds: string[]) => call("/api/plugins", "POST", { id, config, botIds }),
  remove: (id: string) => call(`/api/plugins/${id}`, "DELETE"),
  configure: (id: string, config: Record<string, string>) => call<{ plugin: { id: string; changed: boolean } }>(`/api/plugins/${id}/config`, "PUT", { config }).then((r) => r.plugin),
  test: (id: string) => call<PluginTest>(`/api/plugins/${id}/test`, "POST", {}),
  connect: (id: string, options?: Record<string, unknown>) => call<{ authorizeUrl?: string; qrDataUrl?: string; message?: string; data?: Record<string, unknown> }>(`/api/plugins/${id}/connect`, "POST", options ? { options } : {}),
  disconnect: (id: string) => call(`/api/plugins/${id}/disconnect`, "POST", {}),
  botPlugins: (botId: string) => call<{ plugins: string[] }>(`/api/bots/${botId}/plugins`).then((r) => r.plugins),
  setBound: (botId: string, id: string, on: boolean) => call(`/api/bots/${botId}/plugins/${id}`, on ? "PUT" : "DELETE", on ? {} : undefined),
};

/** Catalog + the user's installed plugins. */
export function usePlugins(onError: (m: string) => void) {
  const [catalog, setCatalog] = useState<PluginMeta[]>();
  const [installed, setInstalled] = useState<InstalledPlugin[]>();
  const reload = useCallback(async () => {
    try { const [c, i] = await Promise.all([pluginsApi.catalog(), pluginsApi.installed()]); setCatalog(c); setInstalled(i); } catch (e) { onError(errorMessage(e)); }
  }, [onError]);
  useEffect(() => { void reload(); }, [reload]);
  return { catalog, installed, reload };
}

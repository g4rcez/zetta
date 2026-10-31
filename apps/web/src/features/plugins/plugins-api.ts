import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { call, errorMessage, sendSealed } from "../chat/chat-client";

export type PluginField = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  kind?: "text" | "password" | "url" | "textarea" | "select";
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
};
export type PluginMeta = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  auth: "none" | "api-key" | "oauth";
  kind: "mcp" | "native";
  transport: "http" | "stdio" | null;
  fields: PluginField[];
  docsUrl: string | null;
  verified: boolean;
  notes: string | null;
  /** Numbered setup steps; empty when the plugin has none. */
  guide: string[];
  credentials: boolean;
  /** Built in and on for every bot: nothing to install. */ always?: boolean;
  tools: { name: string; description: string }[];
};
/** `private`: your own configuration. `team`: the workspace's one, set up by the administrator and used by every member. */
export type PluginSharing = "private" | "team";
export type PluginScope = "mine" | "team";
export type InstalledPlugin = {
  id: string;
  serverId: string;
  hasSecret: boolean;
  sharing: PluginSharing;
};
/** One configuration of a plugin that a bot has switched on. */
export type BotPluginConfig = { id: string; scope: PluginScope };
export type PluginTest = {
  status: {
    state: "connected" | "needs-auth" | "error";
    detail?: string;
    info?: Record<string, unknown>;
  };
  tools: { name: string; description: string }[];
};

export type ToolAccess = {
  tools: { name: string; description: string }[];
  toolsMode: "all" | "selected";
  allowedTools: string[];
};

export const CATEGORY_LABEL: Record<string, string> = {
  monitoring: "Monitoring",
  analytics: "Analytics",
  cloud: "Cloud",
  dev: "Development",
  productivity: "Productivity",
  docs: "Docs",
  browser: "Browser",
  messaging: "Messaging",
  social: "Social",
  google: "Google",
  security: "Passwords",
  other: "Other",
};

const at = (path: string, scope: PluginScope) => (scope === "team" ? `${path}?scope=team` : path);

/** The plugin API for one configuration: the user's own (`mine`) or the workspace's (`team`). */
export const pluginsApiFor = (scope: PluginScope) => ({
  catalog: () => call<{ plugins: PluginMeta[] }>("/api/plugins/catalog").then((r) => r.plugins),
  installed: () => call<{ plugins: InstalledPlugin[] }>("/api/plugins").then((r) => r.plugins),
  install: (id: string, config: Record<string, string>, botIds: string[]) =>
    sendSealed(`plugin.install:${id}`, { config }, (sealed) =>
      call(at("/api/plugins", scope), "POST", { id, sealed, botIds }),
    ),
  remove: (id: string) => call(at(`/api/plugins/${id}`, scope), "DELETE"),
  configure: (id: string, config: Record<string, string>) =>
    sendSealed(`plugin.configure:${id}`, { config }, (sealed) =>
      call<{ plugin: { id: string; changed: boolean } }>(
        at(`/api/plugins/${id}/config`, scope),
        "PUT",
        { sealed },
      ),
    ).then((r) => r.plugin),
  test: (id: string) => call<PluginTest>(at(`/api/plugins/${id}/test`, scope), "POST", {}),
  connect: (id: string, options?: Record<string, unknown>) =>
    call<{
      authorizeUrl?: string;
      qrDataUrl?: string;
      message?: string;
      data?: Record<string, unknown>;
    }>(at(`/api/plugins/${id}/connect`, scope), "POST", options ? { options } : {}),
  disconnect: (id: string) => call(at(`/api/plugins/${id}/disconnect`, scope), "POST", {}),
  /** The plugin ids a bot uses, and which configuration of each. */
  botPlugins: (botId: string) =>
    call<{ plugins: string[]; configs: BotPluginConfig[] }>(`/api/bots/${botId}/plugins`),
  toolAccess: (botId: string, serverId: string) =>
    call<ToolAccess>(`/api/bots/${botId}/integrations/${serverId}/tools`),
  setToolAccess: (
    botId: string,
    serverId: string,
    v: Pick<ToolAccess, "toolsMode" | "allowedTools">,
  ) =>
    call<Pick<ToolAccess, "toolsMode" | "allowedTools">>(
      `/api/bots/${botId}/integrations/${serverId}/tools`,
      "PUT",
      v,
    ),
  setBound: (botId: string, id: string, on: boolean) =>
    call(at(`/api/bots/${botId}/plugins/${id}`, scope), on ? "PUT" : "DELETE", on ? {} : undefined),
});
export const pluginsApi = pluginsApiFor("mine");

const ScopeContext = createContext<PluginScope>("mine");
/** Everything below it talks to this configuration of the plugin (the page's Individual / Shared switch). */
export const PluginScopeProvider = ScopeContext.Provider;
export const usePluginScope = () => useContext(ScopeContext);
/** The plugin API for the configuration the page is showing. */
export function usePluginApi() {
  const scope = useContext(ScopeContext);
  return useMemo(() => pluginsApiFor(scope), [scope]);
}

/** Catalog + the user's installed plugins. */
export function usePlugins(onError: (m: string) => void) {
  const [catalog, setCatalog] = useState<PluginMeta[]>();
  const [installed, setInstalled] = useState<InstalledPlugin[]>();
  const reload = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([pluginsApi.catalog(), pluginsApi.installed()]);
      setCatalog(c);
      setInstalled(i);
    } catch (e) {
      onError(errorMessage(e));
    }
  }, [onError]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { catalog, installed, reload };
}

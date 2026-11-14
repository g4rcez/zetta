import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";

import { call, errorMessage, sendSealed } from "../chat/chat-client";
import { STATIC } from "@/lib/query-policy";

export type PluginField = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  kind?: "text" | "password" | "url" | "textarea" | "select" | "languages";
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
  /** Finishes a sign-in whose redirect could not load (Google "Desktop app" client): `url` is the address the user pasted. */
  complete: (id: string, url: string) =>
    call<{ ok: true }>(at(`/api/plugins/${id}/complete`, scope), "POST", { url }),
  /** `options.account` disconnects one account of a plugin that has several (Google); without it everything is disconnected. */
  disconnect: (id: string, options?: Record<string, unknown>) =>
    call(at(`/api/plugins/${id}/disconnect`, scope), "POST", options ? { options } : {}),
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

/** Every plugin read has one key under `["plugins"]`: invalidate that prefix after an install, a removal or a setting change. */
export const pluginsQueries = {
  catalog: () =>
    queryOptions({
      queryKey: ["plugins", "catalog"],
      queryFn: () => pluginsApi.catalog(),
      ...STATIC,
    }),
  installed: () =>
    queryOptions({
      queryKey: ["plugins", "installed"],
      queryFn: () => pluginsApi.installed(),
      ...STATIC,
    }),
  /** The plugins one bot uses. The answer does not depend on the page's Individual / Shared switch. */
  botPlugins: (botId: string) =>
    queryOptions({
      queryKey: ["plugins", "bots", botId],
      queryFn: () => pluginsApi.botPlugins(botId),
    }),
  toolAccess: (botId: string, serverId: string) =>
    queryOptions({
      queryKey: ["plugins", "bots", botId, "tools", serverId],
      queryFn: () => pluginsApi.toolAccess(botId, serverId),
    }),
};

/** Shows a saved on / off switch at once, without a second request. */
export function setBoundInCache(
  qc: QueryClient,
  botId: string,
  id: string,
  scope: PluginScope,
  on: boolean,
) {
  qc.setQueryData<Awaited<ReturnType<typeof pluginsApi.botPlugins>>>(
    pluginsQueries.botPlugins(botId).queryKey,
    (old) => {
      if (!old) return old;
      const configs = old.configs.filter((c) => !(c.id === id && c.scope === scope));
      if (on) configs.push({ id, scope });
      return { plugins: [...new Set(configs.map((c) => c.id))], configs };
    },
  );
}

/** Catalog + the user's installed plugins. */
export function usePlugins(onError: (m: string) => void) {
  const qc = useQueryClient();
  const catalog = useQuery(pluginsQueries.catalog());
  const installed = useQuery(pluginsQueries.installed());
  const error = catalog.error ?? installed.error;
  useEffect(() => {
    if (error) onError(errorMessage(error));
    // `onError` is usually an inline function; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["plugins"] }), [qc]);
  return { catalog: catalog.data, installed: installed.data, reload };
}

import { useEffect, useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { Empty } from "../shared/ui";
import { PluginIcon } from "./plugin-icon";
import {
  pluginsApi,
  pluginsApiFor,
  type InstalledPlugin,
  type PluginMeta,
  type PluginScope,
} from "./plugins-api";
import { ToggleCard } from "./toggle-card";
import { ToolPicker } from "./tool-picker";
import { Alert } from "@g4rcez/components/alert";

const key = (id: string, scope: PluginScope) => `${id}:${scope}`;

/**
 * Which installed plugins / MCP servers one bot may use. Bindings are per user: toggling here never affects another person's access
 * to a shared bot. A plugin set up both for you and for the team shows two rows; with both on, the bot asks which one to use. Mount inside any bot settings surface: `<BotPluginsSection botId={bot.id} />`.
 */
export function BotPluginsSection({
  botId,
  disabled = false,
}: {
  botId: string;
  disabled?: boolean;
}) {
  const [catalog, setCatalog] = useState<PluginMeta[]>();
  const [installed, setInstalled] = useState<InstalledPlugin[]>();
  const [bound, setBound] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setError(undefined);
    Promise.all([pluginsApi.catalog(), pluginsApi.installed(), pluginsApi.botPlugins(botId)])
      .then(([c, i, b]) => {
        if (live) {
          setCatalog(c);
          setInstalled(i);
          setBound(new Set(b.configs.map((x) => key(x.id, x.scope))));
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [botId]);
  async function toggle(id: string, scope: PluginScope, on: boolean) {
    setBusy(key(id, scope));
    setError(undefined);
    try {
      await pluginsApiFor(scope).setBound(botId, id, on);
      setBound((s) => {
        const n = new Set(s);
        if (on) n.add(key(id, scope));
        else n.delete(key(id, scope));
        return n;
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  const rows = (installed ?? [])
    .map((i) => ({
      i,
      scope: (i.sharing === "team" ? "team" : "mine") as PluginScope,
      meta: catalog?.find((c) => c.id === i.id),
    }))
    .filter((r) => r.meta);
  return (
    <section aria-label="Plugins" className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">Plugins and MCP servers</h3>
        <p className="text-xs text-muted-foreground">
          Choose what this bot may use on your behalf. Install more in Studio &gt; Plugins.
        </p>
      </div>
      {error && <Alert theme="danger">{error}</Alert>}
      {installed === undefined && !error && <Empty>Loading...</Empty>}
      {installed && rows.length === 0 && <Empty>No plugins installed yet.</Empty>}
      <ul className="space-y-2">
        {rows.map(({ i, scope, meta }) => {
          const k = key(i.id, scope);
          const both = rows.filter((r) => r.i.id === i.id && bound.has(key(r.i.id, r.scope)));
          return (
            <li key={k} className="space-y-1">
              <ToggleCard
                leading={<PluginIcon id={meta!.id} name={meta!.icon} className="size-6" />}
                title={`${meta!.name}${scope === "team" ? " (team)" : ""}`}
                description={meta!.description}
                {...(scope === "team"
                  ? {
                      detail:
                        "The workspace's shared account, set up by the administrator. Every tool is available.",
                    }
                  : {})}
                label={`${meta!.name}${scope === "team" ? " (team)" : ""} can be used by this bot`}
                checked={bound.has(k)}
                disabled={disabled || busy === k}
                onChange={(on) => void toggle(i.id, scope, on)}
              />
              {bound.has(k) && both.length > 1 && scope === "mine" && (
                <p className="text-xs text-muted-foreground">
                  This bot uses your own and the team's {meta!.name}. It asks which one to use
                  before it starts.
                </p>
              )}
              {bound.has(k) && (
                <ToolPicker
                  botId={botId}
                  serverId={i.serverId}
                  name={`${meta!.name}${scope === "team" ? " (team)" : ""}`}
                  disabled={disabled}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

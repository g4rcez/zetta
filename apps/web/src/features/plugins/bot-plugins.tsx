import { useEffect, useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { Empty } from "../shared/ui";
import { PluginIcon } from "./plugin-icon";
import {
  pluginsApi,
  type InstalledPlugin,
  type PluginMeta,
  type SharedPlugin,
} from "./plugins-api";
import { ToggleCard } from "./toggle-card";
import { ToolPicker } from "./tool-picker";
import { Alert } from "@g4rcez/components/alert";

/**
 * Which installed plugins / MCP servers one bot may use. Bindings are per user: toggling here never affects another person's access
 * to a shared bot. Mount inside any bot settings surface: `<BotPluginsSection botId={bot.id} />`.
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
  const [shared, setShared] = useState<SharedPlugin[]>([]);
  const [bound, setBound] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setError(undefined);
    Promise.all([
      pluginsApi.catalog(),
      pluginsApi.installed(),
      pluginsApi.botPlugins(botId),
      pluginsApi.shared(),
    ])
      .then(([c, i, b, s]) => {
        if (live) {
          setCatalog(c);
          setInstalled(i);
          setShared(s);
          setBound(new Set(b));
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [botId]);
  async function toggle(id: string, on: boolean) {
    setBusy(id);
    setError(undefined);
    try {
      await pluginsApi.setBound(botId, id, on);
      setBound((s) => {
        const n = new Set(s);
        if (on) n.add(id);
        else n.delete(id);
        return n;
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  const rows = [
    ...(installed ?? []).map((i) => ({
      i,
      meta: catalog?.find((c) => c.id === i.id),
      by: undefined as string | undefined,
    })),
    // A teammate's shared plugin shows up beside your own; if you installed the same plugin yourself, yours is used.
    ...shared
      .filter((s) => !installed?.some((i) => i.id === s.id))
      .map((s) => ({
        i: { id: s.id, serverId: s.serverId, hasSecret: true, sharing: "team" as const },
        meta: catalog?.find((c) => c.id === s.id),
        by: s.ownerName,
      })),
  ].filter((r) => r.meta);
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
        {rows.map(({ i, meta, by }) => (
          <li key={meta!.id} className="space-y-1">
            <ToggleCard
              leading={<PluginIcon id={meta!.id} name={meta!.icon} className="size-6" />}
              title={meta!.name}
              description={meta!.description}
              {...(by
                ? {
                    detail: `Shared by ${by} with the team. It acts through their account and can only use: ${shared.find((s) => s.id === meta!.id)?.tools.join(", ")}.`,
                  }
                : {})}
              label={`${meta!.name} can be used by this bot`}
              checked={bound.has(meta!.id)}
              disabled={disabled || busy === meta!.id}
              onChange={(on) => void toggle(meta!.id, on)}
            />
            {bound.has(meta!.id) && (
              <ToolPicker
                botId={botId}
                serverId={i.serverId}
                name={meta!.name}
                disabled={disabled}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useEffect, useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { Empty } from "../shared/ui";
import { PluginIcon } from "./plugin-icon";
import { pluginsApi, type InstalledPlugin, type PluginMeta } from "./plugins-api";
import { ToggleCard } from "./toggle-card";

/**
 * Which installed plugins / MCP servers one bot may use. Bindings are per user: toggling here never affects another person's access
 * to a shared bot. Mount inside any bot settings surface: `<BotPluginsSection botId={bot.id} />`.
 */
export function BotPluginsSection({ botId, disabled = false }: { botId: string; disabled?: boolean }) {
  const [catalog, setCatalog] = useState<PluginMeta[]>();
  const [installed, setInstalled] = useState<InstalledPlugin[]>();
  const [bound, setBound] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true; setError(undefined);
    Promise.all([pluginsApi.catalog(), pluginsApi.installed(), pluginsApi.botPlugins(botId)])
      .then(([c, i, b]) => { if (live) { setCatalog(c); setInstalled(i); setBound(new Set(b)); } })
      .catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [botId]);
  async function toggle(id: string, on: boolean) {
    setBusy(id); setError(undefined);
    try { await pluginsApi.setBound(botId, id, on); setBound((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(undefined); }
  }
  const rows = (installed ?? []).map((i) => ({ i, meta: catalog?.find((c) => c.id === i.id) })).filter((r) => r.meta);
  return (
    <section aria-label="Plugins" className="space-y-2">
      <div><h3 className="text-sm font-medium">Plugins and MCP servers</h3><p className="text-xs text-muted-foreground">Choose what this bot may use on your behalf. Install more in Studio &gt; Plugins.</p></div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {installed === undefined && !error && <Empty>Loading...</Empty>}
      {installed && rows.length === 0 && <Empty>No plugins installed yet.</Empty>}
      <ul className="space-y-2">
        {rows.map(({ meta }) => (
          <li key={meta!.id}>
            <ToggleCard
              leading={<PluginIcon id={meta!.id} name={meta!.icon} className="size-6" />}
              title={meta!.name} description={meta!.description} label={`${meta!.name} can be used by this bot`}
              checked={bound.has(meta!.id)} disabled={disabled || busy === meta!.id} onChange={(on) => void toggle(meta!.id, on)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

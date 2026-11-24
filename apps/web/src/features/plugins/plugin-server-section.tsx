import { type ReactNode } from "react";

import { BotMailSettings } from "../studio/bot-mail-settings";
import { WahaSettings } from "../studio/waha-settings";

/** The plugins whose page carries a server setup for administrators; a built-in one has no other way in from the list. */
export const PLUGINS_WITH_SERVER_SETUP: ReadonlySet<string> = new Set(["whatsapp", "botmail"]);

type SectionProps = { title: string; note: string; children: ReactNode };

/** The server-wide setup of a plugin, under its page: one heading, one sentence, the card. */
function ServerSection({ title, note, children }: SectionProps) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{note}</p>
      </div>
      <div className="rounded-xl border bg-card p-5">{children}</div>
    </section>
  );
}

/**
 * What only an administrator of the installation sets for a plugin, shown on the plugin's own page: the shared WhatsApp server and the
 * operator's Resend setup for the bot e-mail address. `isAdmin` is the installation administrator flag (not "may manage this plugin"):
 * anyone else gets nothing here, and nothing is asked of the server.
 */
export function PluginServerSection({ pluginId, isAdmin }: { pluginId: string; isAdmin: boolean }) {
  if (!isAdmin) return null;
  if (pluginId === "whatsapp")
    return (
      <ServerSection
        title="Server for everyone"
        note="The WhatsApp server every person shares unless they set up their own. Only administrators change it."
      >
        <WahaSettings />
      </ServerSection>
    );
  if (pluginId === "botmail")
    return (
      <ServerSection
        title="Server setup"
        note="How this server sends and receives the e-mail address every bot gets. Only administrators change it."
      >
        <BotMailSettings />
      </ServerSection>
    );
  return null;
}

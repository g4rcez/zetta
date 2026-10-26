import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/ui";

import { chatClient, errorMessage, type Bot } from "../chat/chat-client";

const OPTIONS = [{ value: "on", label: "On" }, { value: "off", label: "Off" }];

/** Owner-controlled "Code access" capability of a bot (on by default). Mount it inside the bot settings. */
export function BotCodeSection({ bot, onBotChange }: { bot: Bot; onBotChange?: (bot: Bot) => void }) {
  const [on, setOn] = useState(bot.codeAccess ?? true);
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const version = useRef(bot.version);
  useEffect(() => { setOn(bot.codeAccess ?? true); version.current = bot.version; }, [bot.codeAccess, bot.version]);
  async function change(next: boolean) {
    const previous = on;
    setOn(next); setBusy(true); setStatus(undefined);
    try {
      const updated = await chatClient.updateBot(bot.id, version.current, { codeAccess: next });
      version.current = updated.version; onBotChange?.(updated);
      setStatus(next ? "Code access saved." : "Code access is off.");
    } catch (e) { setOn(previous); setStatus(errorMessage(e)); }
    setBusy(false);
  }
  return (
    <section aria-label="Code access" className="space-y-2">
      <Select title="Code access" required={false} value={on ? "on" : "off"} disabled={busy || !bot.canEdit} onChange={(e) => void change(e.target.value === "on")} options={OPTIONS} />
      <p className="text-xs text-muted-foreground">
        {on ? "This bot can clone repositories, read and edit code, run git, create branches, commit and push in your own persistent workspace. For private repositories and pushes, add a GitHub account under Accounts and require it for this bot."
          : "This bot cannot run git or touch code."}
        {!bot.canEdit ? " Only the owner can change this." : ""}
      </p>
      <p role="status" className="text-xs empty:hidden">{status}</p>
    </section>
  );
}

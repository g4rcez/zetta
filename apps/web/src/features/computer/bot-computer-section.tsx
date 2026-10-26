import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/ui";

import { call, chatClient, errorMessage, type Bot, type ComputerMode } from "../chat/chat-client";

const OPTIONS: { value: ComputerMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "browser", label: "Browser only" },
  { value: "desktop", label: "Browser + desktop" },
];
const HELP: Record<ComputerMode, string> = {
  off: "This bot cannot open pages or control a desktop.",
  browser: "This bot can open public pages, read them and click or type in your own private browser. It stops and asks you to take over for sign-ins.",
  desktop: "Also lets the bot use your private Linux desktop. Everything runs in your own isolated session, never another person's.",
};

/** Owner-controlled "Computer use" capability of a bot (off by default). Mount it inside the bot settings. */
export function BotComputerSection({ bot, onBotChange }: { bot: Bot; onBotChange?: (bot: Bot) => void }) {
  const [mode, setMode] = useState<ComputerMode>(bot.computerMode ?? "off");
  const [desktop, setDesktop] = useState(true);
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const version = useRef(bot.version);
  useEffect(() => { setMode(bot.computerMode ?? "off"); version.current = bot.version; }, [bot.computerMode, bot.version]);
  useEffect(() => { call<{ desktop: boolean }>("/api/computer/capabilities").then((c) => setDesktop(c.desktop), () => {}); }, []);
  async function change(next: ComputerMode) {
    const previous = mode;
    setMode(next); setBusy(true); setStatus(undefined);
    try {
      const updated = await chatClient.updateBot(bot.id, version.current, { computerMode: next });
      version.current = updated.version; onBotChange?.(updated);
      setStatus(next === "off" ? "Computer use is off." : "Computer use saved.");
    } catch (e) { setMode(previous); setStatus(errorMessage(e)); }
    setBusy(false);
  }
  return (
    <section aria-label="Computer use" className="space-y-2">
      <Select title="Computer use" required={false} value={mode} disabled={busy || !bot.canEdit} onChange={(e) => void change(e.target.value as ComputerMode)}
        options={OPTIONS.map((o) => ({ ...o, disabled: o.value === "desktop" && !desktop }))} />
      <p className="text-xs text-muted-foreground">{HELP[mode]}{!desktop && mode !== "desktop" ? " The desktop is not available in this installation." : ""}{!bot.canEdit ? " Only the owner can change this." : ""}</p>
      <p role="status" className="text-xs empty:hidden">{status}</p>
    </section>
  );
}

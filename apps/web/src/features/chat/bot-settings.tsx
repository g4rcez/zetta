import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { Textarea } from "@/components/ui";

import { field } from "../shared/ui";
import { BotAccounts } from "./bot-accounts";
import { BotDecision } from "./bot-decision";
import { BotHooks } from "./bot-hooks";
import { chatClient, errorMessage, type Bot, type Workspace } from "./chat-client";

export function BotSettings({ bot, bots, spaces, onBotChange, notify }: { bot: Bot; bots: Bot[]; spaces: Workspace[]; onBotChange: (b: Bot) => void; notify: (m: string) => void }) {
  const [error, setError] = useState<string>();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      onBotChange(await chatClient.updateBot(bot.id, bot.version, { harness: String(data.get("harness") ?? "fixture"), model: String(data.get("model") ?? "").trim() || null, personality: String(data.get("personality") ?? ""), instructions: String(data.get("instructions") ?? "") }));
      notify("Saved. Chat with the bot again to confirm it is ready.");
    } catch (e) { setError(errorMessage(e)); }
  }
  if (!bot.canEdit) {
    return <div className="text-sm"><BotAccounts bot={bot} onBotChange={onBotChange} /></div>;
  }
  return (
    <div className="min-w-0 space-y-5 text-sm">
      <form key={`${bot.id}-${bot.version}`} onSubmit={(e) => void save(e)} className="space-y-3 rounded-lg border bg-card p-4">
        <label className="block space-y-1"><span className="font-medium">Harness</span><select name="harness" defaultValue={bot.harness} className={field}>{["fixture", "claude-code", "codex", "pi", "omp", "opencode", "cursor"].map((h) => <option key={h} value={h}>{h === "fixture" ? "fixture (offline test)" : h === "claude-code" ? h : `${h} (not verified yet)`}</option>)}</select></label>
        <label className="block space-y-1"><span className="font-medium">Model (optional)</span><input name="model" defaultValue={bot.model ?? ""} placeholder="e.g. haiku" className={field} /></label>
        <label className="block space-y-1"><span className="font-medium">Personality</span><Textarea name="personality" defaultValue={bot.personality} rows={2} /></label>
        <label className="block space-y-1"><span className="font-medium">Instructions</span><Textarea name="instructions" defaultValue={bot.instructions} rows={3} /></label>
        <Button type="submit" size="sm">Save settings</Button>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </form>
      {spaces.length > 0 && <label className="block space-y-1"><span className="font-medium">Workspace</span><select value={bot.workspaceId ?? ""} onChange={(e) => void chatClient.moveBot(bot.id, e.target.value || null).then((b) => onBotChange({ ...bot, workspaceId: b.workspaceId }), (x) => setError(errorMessage(x)))} className={field}><option value="">Ungrouped</option>{spaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
      <BotAccounts bot={bot} onBotChange={onBotChange} />
      <BotHooks bot={bot} />
      <BotDecision bot={bot} bots={bots} />
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

import { chatClient, errorMessage, PROVIDERS, type Bot, type ConnectionList, type Provider, type RequiredConnection, type Requirement } from "./chat-client";
import { field } from "../shared/ui";

export const KEY_PATTERN = /^[a-z0-9_-]{1,32}$/;
const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter" };
const STATUS: Record<Requirement["status"], string> = { ready: "Connected", missing: "Not connected yet. Choose an account below.", unusable: "The chosen account cannot be used (it may have been revoked). Choose another." };

/** Required accounts: owners edit the list; every user (owner or not) binds their own account to each requirement. */
export function BotAccounts({ bot, onBotChange }: { bot: Bot; onBotChange: (b: Bot) => void }) {
  const [draft, setDraft] = useState<RequiredConnection[]>(bot.requiredConnections ?? []);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [conns, setConns] = useState<ConnectionList>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const reload = useCallback(() => { void chatClient.requirements(bot.id).then(setReqs, () => setReqs([])); }, [bot.id]);
  useEffect(() => { reload(); chatClient.connections().then(setConns, () => setConns(undefined)); }, [reload, bot.version]);
  useEffect(() => setDraft(bot.requiredConnections ?? []), [bot.requiredConnections]);

  const invalid = draft.some((r) => !KEY_PATTERN.test(r.key)) || new Set(draft.map((r) => r.key)).size !== draft.length;
  async function save() {
    setError(undefined); setStatus(undefined);
    try { onBotChange(await chatClient.updateBot(bot.id, bot.version, { requiredConnections: draft })); setStatus("Required accounts saved."); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function bind(key: string, connectionId: string) {
    if (!connectionId) return;
    setError(undefined); setStatus(undefined);
    try { await chatClient.bindConnection(bot.id, key, connectionId); setStatus("Account chosen."); reload(); } catch (e) { setError(errorMessage(e)); }
  }
  if (!bot.canEdit && reqs.length === 0) return null;
  return (
    <section aria-label="Required accounts" className="space-y-2 rounded-lg border bg-card p-4">
      <h3 className="font-medium">Accounts this bot needs</h3>
      {conns && !conns.configured && <p className="text-xs text-muted-foreground">Accounts are not set up on this server. The administrator must set it up before accounts can be connected.</p>}
      {reqs.length === 0 && <p className="text-xs text-muted-foreground">No accounts required.</p>}
      <ul className="space-y-2">{reqs.map((r) => {
        const options = (conns?.connections ?? []).filter((c) => c.provider === r.provider && c.state === "active");
        return (
          <li key={r.key} className="min-w-0 space-y-1 rounded-md border bg-card p-3">
            <p><code>{r.key}</code> · {PROVIDER_NAME[r.provider]} · <span className={r.status === "ready" ? "" : "text-destructive"}>{STATUS[r.status]}</span></p>
            <label className="block text-xs">Use my account
              <select className={`${field} mt-0.5`} value="" onChange={(e) => void bind(r.key, e.target.value)} disabled={options.length === 0}>
                <option value="">{options.length ? "Choose an account…" : `No active ${PROVIDER_NAME[r.provider]} accounts. Add one in Studio, Accounts.`}</option>
                {options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          </li>);
      })}</ul>
      {bot.canEdit && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Edit the list of accounts this bot needs. The key is a short name (lowercase letters, numbers, - or _).</p>
          {draft.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1">
              <input aria-label={`Account ${i + 1} key`} aria-invalid={!KEY_PATTERN.test(r.key)} value={r.key} onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)))} className={`${field} w-32`} />
              <select aria-label={`Account ${i + 1} provider`} value={r.provider} onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, provider: e.target.value as Provider } : x)))} className={`${field} w-36`}>{PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_NAME[p]}</option>)}</select>
              <Button type="button" size="sm" variant="outline" onClick={() => setDraft(draft.filter((_, k) => k !== i))}>Remove<span className="sr-only"> account {i + 1}</span></Button>
            </div>))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={draft.length >= 8} onClick={() => setDraft([...draft, { key: "", provider: "anthropic" }])}>Add requirement</Button>
            <Button type="button" size="sm" disabled={invalid} onClick={() => void save()}>Save requirements</Button>
          </div>
          {invalid && draft.length > 0 && <p className="text-xs text-destructive">Each key needs 1 to 32 lowercase letters, numbers, - or _, and keys must be different.</p>}
        </div>)}
      <p role="status" className="text-xs">{status}</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

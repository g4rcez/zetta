import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";

import {
  chatClient,
  errorMessage,
  PROVIDERS,
  type Bot,
  type Provider,
  type RequiredConnection,
  type Requirement,
} from "./chat-client";
import { chatQueries } from "./chat-queries";

export const KEY_PATTERN = /^[a-z0-9_-]{1,32}$/;
const PROVIDER_NAME: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  github: "GitHub",
};
const STATUS: Record<Requirement["status"], string> = {
  ready: "Connected",
  missing: "Not connected yet. Choose an account below.",
  unusable: "The chosen account cannot be used (it may have been revoked). Choose another.",
};

const NONE: Requirement[] = [];

/** Required accounts: owners edit the list; every user (owner or not) binds their own account to each requirement. */
export function BotAccounts({ bot, onBotChange }: { bot: Bot; onBotChange: (b: Bot) => void }) {
  const [draft, setDraft] = useState<RequiredConnection[]>(bot.requiredConnections ?? []);
  const qc = useQueryClient();
  const reqsQuery = chatQueries.requirements(bot.id, bot.version);
  const reqs = useQuery({ ...reqsQuery, placeholderData: keepPreviousData }).data ?? NONE;
  const conns = useQuery(chatQueries.connections()).data;
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => setDraft(bot.requiredConnections ?? []), [bot.requiredConnections]);

  const invalid =
    draft.some((r) => !KEY_PATTERN.test(r.key)) ||
    new Set(draft.map((r) => r.key)).size !== draft.length;
  async function save() {
    setError(undefined);
    setStatus(undefined);
    try {
      onBotChange(await chatClient.updateBot(bot.id, bot.version, { requiredConnections: draft }));
      setStatus("Required accounts saved.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function bind(key: string, connectionId: string) {
    if (!connectionId) return;
    setError(undefined);
    setStatus(undefined);
    try {
      await chatClient.bindConnection(bot.id, key, connectionId);
      setStatus("Account chosen.");
      await qc.invalidateQueries({ queryKey: ["bots", bot.id, "requirements"] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (!bot.canEdit && reqs.length === 0) return null;
  return (
    <section aria-label="Required accounts" className="space-y-4 rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold tracking-tight">Accounts this bot needs</h3>
      {conns && !conns.configured && (
        <p className="text-xs text-muted-foreground">
          Accounts are not set up on this server. The administrator must set it up before accounts
          can be connected.
        </p>
      )}
      {reqs.length === 0 && <p className="text-xs text-muted-foreground">No accounts required.</p>}
      <ul className="space-y-2">
        {reqs.map((r) => {
          const options = (conns?.connections ?? []).filter(
            (c) => c.provider === r.provider && c.state === "active",
          );
          return (
            <li key={r.key} className="min-w-0 space-y-1 rounded-md border bg-card p-3">
              <p>
                <code>{r.key}</code> · {PROVIDER_NAME[r.provider]} ·{" "}
                <span className={r.status === "ready" ? "" : "text-destructive"}>
                  {STATUS[r.status]}
                </span>
              </p>
              <Select
                title="Use my account"
                container="mt-0.5"
                required={false}
                value=""
                onChange={(e) => void bind(r.key, e.target.value)}
                disabled={options.length === 0}
                placeholder={
                  options.length
                    ? "Choose an account…"
                    : `No active ${PROVIDER_NAME[r.provider]} accounts. Add one in Studio, Accounts.`
                }
                options={options.map((c) => ({ value: c.id, label: c.label }))}
              />
            </li>
          );
        })}
      </ul>
      {bot.canEdit && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Edit the list of accounts this bot needs. The key is a short name (lowercase letters,
            numbers, - or _).
          </p>
          {draft.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1">
              <Input
                title={`Account ${i + 1} key`}
                hiddenLabel
                container="w-32"
                aria-invalid={!KEY_PATTERN.test(r.key)}
                value={r.key}
                onChange={(e) =>
                  setDraft(draft.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)))
                }
              />
              <Select
                title={`Account ${i + 1} provider`}
                hiddenLabel
                container="w-36"
                required={false}
                value={r.provider}
                onChange={(e) =>
                  setDraft(
                    draft.map((x, k) =>
                      k === i ? { ...x, provider: e.target.value as Provider } : x,
                    ),
                  )
                }
                options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_NAME[p] }))}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDraft(draft.filter((_, k) => k !== i))}
              >
                Remove<span className="sr-only"> account {i + 1}</span>
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={draft.length >= 8}
              onClick={() => setDraft([...draft, { key: "", provider: "anthropic" }])}
            >
              Add requirement
            </Button>
            <Button type="button" size="sm" disabled={invalid} onClick={() => void save()}>
              Save requirements
            </Button>
          </div>
          {invalid && draft.length > 0 && (
            <p className="text-xs text-destructive">
              Each key needs 1 to 32 lowercase letters, numbers, - or _, and keys must be different.
            </p>
          )}
        </div>
      )}
      <p role="status" className="text-xs">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

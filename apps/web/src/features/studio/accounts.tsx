import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Input, Select } from "@/components/ui";

import {
  call,
  errorMessage,
  PROVIDERS,
  sendSealed,
  type Connection,
  type Provider,
} from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem } from "../shared/ui";
import { Alert } from "@g4rcez/components/alert";
import { connectionsQueries, harnessQueries, useLoadError, type Harness } from "./studio-queries";
import { formText } from "../shared/form-data";

const PROVIDER_NAME: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  github: "GitHub",
};
const HARNESS_STATUS: Record<
  Harness["status"],
  { label: string; tone: "success" | "neutral" | "warning" | "danger" }
> = {
  ready: { label: "Ready", tone: "success" },
  not_installed: { label: "Not installed", tone: "danger" },
  needs_login: { label: "Needs sign-in", tone: "warning" },
  unverified: { label: "Not tested yet", tone: "neutral" },
};

/** A titled block without card chrome: its rows carry the border. */
const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section aria-label={title} className="min-w-0 space-y-3">
    <header>
      <h3 className="text-base font-medium">{title}</h3>
      <p className="text-sm text-pretty text-muted-foreground">{description}</p>
    </header>
    {children}
  </section>
);
/** Distinct, plain guidance per status (used when the server sends none). */
export function harnessGuidance(h: Harness): string {
  if (h.guidance) return h.guidance;
  switch (h.status) {
    case "ready":
      return "Worked on your last run. Nothing to do.";
    case "not_installed":
      return "This tool is not installed on the server. Ask the administrator to install it.";
    case "needs_login":
      return h.perUserLogin
        ? "Your last run asked for a sign-in. Sign in to this tool with your own account, then chat again."
        : "Your last run asked for a sign-in. Ask the administrator to sign this tool in on the server.";
    case "unverified":
      return "It is installed but has not been used successfully yet. Send a test message with a bot that uses it.";
  }
}
const CONNECTION_STATE = (s: string) =>
  s === "active" ? "In use" : s === "revoked" ? "Revoked" : s;

function Harnesses({ onError }: { onError: (m: string) => void }) {
  const { data: rows, error } = useQuery(harnessQueries.list());
  useLoadError(error, onError);
  return (
    <Section
      title="Bot engines"
      description="The tools that run your bots. Each bot picks one in its settings."
    >
      {!rows && (
        <p role="status" className="text-sm">
          Checking…
        </p>
      )}
      <ul className={list}>
        {rows?.map((h) => {
          const s = HARNESS_STATUS[h.status];
          return (
            <li key={h.harness} className={`${listItem} flex items-start justify-between gap-4`}>
              <div className="min-w-0">
                <p className="font-medium">
                  {h.label}
                  {h.version && (
                    <span className="font-normal text-muted-foreground"> · {h.version}</span>
                  )}
                </p>
                <p className="break-words text-muted-foreground">{harnessGuidance(h)}</p>
              </div>
              <Badge tone={s.tone}>{s.label}</Badge>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Connections({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data, error: loadError } = useQuery(connectionsQueries.list());
  useLoadError(loadError, onError);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = () => qc.invalidateQueries({ queryKey: connectionsQueries.list().queryKey });
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const provider = formText(f, "provider");
      await sendSealed(
        `connection.create:${provider}`,
        { secret: formText(f, "secret") },
        (sealed) =>
          call("/api/connections", "POST", {
            provider,
            label: formText(f, "label").trim() || (PROVIDER_NAME[provider as Provider] ?? provider),
            sealed,
          }),
      );
      setStatus("Account saved. The key is stored encrypted and will not be shown again.");
      await load();
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      form.reset();
      setBusy(false);
    } // the secret field is always cleared
  }
  async function revoke(c: Connection) {
    setError(undefined);
    setStatus(undefined);
    try {
      await call(`/api/connections/${c.id}/revoke`, "POST", { expectedRevision: c.revision });
      setStatus(`Revoked ${c.label}.`);
    } catch (x) {
      setError(errorMessage(x));
    }
    await load();
  }
  return (
    <Section
      title="Connected accounts"
      description="Keys for AI providers that your bots may use. Only you can use yours, and a saved key is never shown again."
    >
      {data && !data.configured && (
        <Alert theme="warn">
          Accounts are turned off on this server. The administrator must set ZETTA_CONNECTION_KEY
          before keys can be saved.
        </Alert>
      )}
      {data?.configured && (
        <details open={data.connections.length === 0} className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Add an account
          </summary>
          <form
            onSubmit={(e) => void create(e)}
            autoComplete="off"
            className="mt-4 grid gap-3 sm:grid-cols-3"
          >
            <Select
              title="Provider"
              required={false}
              name="provider"
              options={(data.providers?.length ? data.providers : [...PROVIDERS]).map((p) => ({
                value: p,
                label: PROVIDER_NAME[p] ?? p,
              }))}
            />
            <Input
              title="Secret key"
              name="secret"
              type="password"
              required
              minLength={8}
              maxLength={8000}
              autoComplete="new-password"
              spellCheck={false}
            />
            <Input
              title="Name (optional)"
              name="label"
              maxLength={100}
              placeholder="Defaults to the provider"
            />
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Saving…" : "Save account"}
              </Button>
            </div>
          </form>
        </details>
      )}
      {status && <Alert theme="info">{status}</Alert>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {data?.configured && data.connections.length === 0 && <Empty>No accounts yet.</Empty>}
      <ul className={list}>
        {data?.connections.map((c) => (
          <li
            key={c.id}
            className={`${listItem} flex flex-wrap items-center justify-between gap-2`}
          >
            <span className="min-w-0 break-words">
              <strong>{c.label}</strong> · {PROVIDER_NAME[c.provider] ?? c.provider} ·{" "}
              {CONNECTION_STATE(c.state)}
            </span>
            {c.state === "active" && (
              <ConfirmButton
                size="xs"
                label="Revoke"
                question="Revoke this account? Bots using it will stop working."
                confirmLabel="Revoke"
                onConfirm={() => revoke(c)}
              />
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Accounts({ onError }: { onError: (m: string) => void }) {
  return (
    <div className="space-y-6">
      <Harnesses onError={onError} />
      <Connections onError={onError} />
    </div>
  );
}

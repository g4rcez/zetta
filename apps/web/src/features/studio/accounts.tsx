import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

import { call, chatClient, errorMessage, PROVIDERS, type Connection, type ConnectionList, type Provider } from "../chat/chat-client";
import { ConfirmButton, Empty, field, Field } from "../shared/ui";

type Harness = { harness: string; label: string; installed: boolean; version?: string | null; status: "ready" | "not_installed" | "needs_login" | "unverified"; perUserLogin: boolean; guidance?: string };

const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter" };
const HARNESS_STATUS: Record<Harness["status"], { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "border-green-600/60" },
  not_installed: { label: "Not installed", tone: "border-destructive/60" },
  needs_login: { label: "Needs sign-in", tone: "border-yellow-600/60" },
  unverified: { label: "Not tested yet", tone: "" },
};
/** Distinct, plain guidance per status (used when the server sends none). */
export function harnessGuidance(h: Harness): string {
  if (h.guidance) return h.guidance;
  switch (h.status) {
    case "ready": return "Worked on your last run. Nothing to do.";
    case "not_installed": return "This tool is not installed on the server. Ask the administrator to install it.";
    case "needs_login": return h.perUserLogin ? "Your last run asked for a sign-in. Sign in to this tool with your own account, then chat again." : "Your last run asked for a sign-in. Ask the administrator to sign this tool in on the server.";
    case "unverified": return "It is installed but has not been used successfully yet. Send a test message with a bot that uses it.";
  }
}
const CONNECTION_STATE = (s: string) => (s === "active" ? "In use" : s === "revoked" ? "Revoked" : s);

function Harnesses({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<Harness[]>();
  useEffect(() => { call<{ harnesses: Harness[] }>("/api/harnesses").then((r) => setRows(r.harnesses), (e) => onError(errorMessage(e))); }, [onError]);
  return (
    <section aria-label="Bot engines" className="space-y-3 rounded-lg border bg-card p-5">
      <h2 className="font-medium">Bot engines</h2>
      <p className="text-xs text-muted-foreground">The tools that run your bots. Each bot picks one in its settings.</p>
      {!rows && <p role="status" className="text-sm">Checking…</p>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{rows?.map((h) => {
        const s = HARNESS_STATUS[h.status];
        return (
          <li key={h.harness} className={`min-w-0 rounded-lg border bg-card p-4 text-sm ${s.tone}`}>
            <p className="font-medium">{h.label}</p>
            <p>{s.label}{h.version ? <span className="text-muted-foreground"> · version {h.version}</span> : null}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{harnessGuidance(h)}</p>
          </li>);
      })}</ul>
    </section>
  );
}

function Connections({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = useState<ConnectionList>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => chatClient.connections().then(setData, (e) => onError(errorMessage(e))), [onError]);
  useEffect(() => { void load(); }, [load]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, f = new FormData(form);
    setBusy(true); setError(undefined); setStatus(undefined);
    try { await call("/api/connections", "POST", { provider: String(f.get("provider")), label: String(f.get("label")).trim(), secret: String(f.get("secret")) }); setStatus("Account saved. The key is stored encrypted and will not be shown again."); await load(); }
    catch (x) { setError(errorMessage(x)); }
    finally { form.reset(); setBusy(false); } // the secret field is always cleared
  }
  async function revoke(c: Connection) {
    setError(undefined); setStatus(undefined);
    try { await call(`/api/connections/${c.id}/revoke`, "POST", { expectedRevision: c.revision }); setStatus(`Revoked ${c.label}.`); } catch (x) { setError(errorMessage(x)); }
    await load();
  }
  return (
    <section aria-label="Connected accounts" className="space-y-3 rounded-lg border bg-card p-5">
      <h2 className="font-medium">Connected accounts</h2>
      <p className="text-xs text-muted-foreground">Keys for AI providers that your bots may use. Only you can use yours, and a saved key is never shown again.</p>
      {data && !data.configured && <p role="alert" className="rounded-lg border border-yellow-600/60 p-2 text-sm">Accounts are turned off on this server. The administrator must set ZETTA_CONNECTION_KEY before keys can be saved.</p>}
      {data?.configured && (
        <form onSubmit={(e) => void create(e)} autoComplete="off" className="grid gap-2 rounded-lg border bg-card p-4 sm:grid-cols-3" aria-label="Add an account">
          <Field label="Provider"><select name="provider" className={field}>{(data.providers?.length ? data.providers : [...PROVIDERS]).map((p) => <option key={p} value={p}>{PROVIDER_NAME[p] ?? p}</option>)}</select></Field>
          <Field label="Name for this account"><input name="label" required maxLength={100} placeholder="e.g. Work key" className={field} /></Field>
          <Field label="Secret key"><input name="secret" type="password" required minLength={8} maxLength={8000} autoComplete="new-password" spellCheck={false} className={field} /></Field>
          <div className="sm:col-span-3"><Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save account"}</Button></div>
        </form>)}
      <p role="status" className="text-sm empty:hidden">{status}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data?.configured && data.connections.length === 0 && <Empty>No accounts yet.</Empty>}
      <ul className="space-y-1">{data?.connections.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm">
          <span className="min-w-0 break-words"><strong>{c.label}</strong> · {PROVIDER_NAME[c.provider] ?? c.provider} · {CONNECTION_STATE(c.state)}</span>
          {c.state === "active" && <ConfirmButton size="xs" label="Revoke" question="Revoke this account? Bots using it will stop working." confirmLabel="Revoke" onConfirm={() => revoke(c)} />}
        </li>))}</ul>
    </section>
  );
}

export function Accounts({ onError }: { onError: (m: string) => void }) {
  return <div className="space-y-6"><Harnesses onError={onError} /><Connections onError={onError} /></div>;
}

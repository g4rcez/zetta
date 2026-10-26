import { CalendarDays, CheckCircle2, HardDrive, Mail, ShieldCheck, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { pluginsApi, type PluginTest } from "./plugins-api";

/** Native checkbox: the label stays beside the box and wraps under its own text, never under the box. */
export function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={`flex items-start gap-2 text-sm leading-snug ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** Google brand glyph (the four-colour "G"). */
export function GoogleLogo({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={className}>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
const GROUPS: Record<string, { icon: LucideIcon; color: string; hint: string }> = {
  Gmail: { icon: Mail, color: "text-[#EA4335]", hint: "Search and draft mail" },
  Calendar: { icon: CalendarDays, color: "text-[#4285F4]", hint: "Check and schedule events" },
  Drive: { icon: HardDrive, color: "text-[#34A853]", hint: "Read documents and files" },
};

/** Mirrors the server's scope ids (plugins/google/oauth.ts). Nothing is requested until the user ticks it. */
const SCOPES: { id: string; label: string; group: string }[] = [
  { id: "gmail.readonly", group: "Gmail", label: "Read messages" },
  { id: "gmail.compose", group: "Gmail", label: "Create drafts (you review and send them yourself)" },
  { id: "gmail.send", group: "Gmail", label: "Send email" },
  { id: "calendar.events.readonly", group: "Calendar", label: "Read events" },
  { id: "calendar.events", group: "Calendar", label: "Create and edit events" },
  { id: "drive.readonly", group: "Drive", label: "Read all files" },
  { id: "drive.file", group: "Drive", label: "Only files created or opened with Zetta" },
];
const REASON: Record<string, string> = { ACCESS_DENIED: "Google access was declined.", INVALID_STATE: "That sign-in link expired. Try again.", STATE_EXPIRED: "That sign-in took too long. Try again.", EXCHANGE_FAILED: "Google rejected the sign-in. Try again.", NO_REFRESH_TOKEN: "Google did not grant offline access. Remove Zetta from your Google account permissions and try again.", NOT_CONFIGURED: "Add your Google OAuth client ID and secret in Settings first." };

/** Studio > Plugins > Google: choose permissions, connect through Google's consent screen, see the account, disconnect. Tokens never reach the browser. */
export function GoogleConnect({ probe, onChanged, onError }: { probe?: PluginTest; onChanged: () => void; onError: (m: string) => void }) {
  const info = probe?.status.info as { email?: string | null; scopes?: string[]; allowSend?: boolean } | undefined;
  const connected = probe?.status.state === "connected";
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [allowSend, setAllowSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => { if (info?.scopes) { setScopes(new Set(info.scopes)); setAllowSend(Boolean(info.allowSend)); } }, [info?.scopes?.join(" "), info?.allowSend]);
  useEffect(() => { // result of the redirect from the server callback: only a flag, never a token
    const q = new URLSearchParams(window.location.search); if (q.get("plugin") !== "google") return;
    const ok = q.get("status") === "ok"; const reason = q.get("reason");
    setNotice(ok ? "Google connected." : REASON[reason ?? ""] ?? "Google could not be connected.");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const toggle = (id: string, on: boolean) => { setScopes((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }); if (id === "gmail.send" && !on) setAllowSend(false); };
  async function connect() {
    setBusy(true); setNotice(undefined);
    try {
      const r = await pluginsApi.connect("google", { scopes: [...scopes], allowSend });
      if (r.authorizeUrl) { window.location.assign(r.authorizeUrl); return; }
      setNotice("Saved."); onChanged();
    } catch (e) { onError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function disconnect() { setBusy(true); try { await pluginsApi.disconnect("google"); setScopes(new Set()); setAllowSend(false); onChanged(); } catch (e) { onError(errorMessage(e)); } finally { setBusy(false); } }
  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" aria-label="Google connection">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{connected ? <><CheckCircle2 aria-hidden className="size-4 text-primary" />Connected as <strong className="text-foreground">{info?.email ?? "your Google account"}</strong></> : probe?.status.state === "error" ? probe.status.detail : "Not connected. Choose what bots may do, then connect."}</p>
      {notice && <p role="status" className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">{notice === "Google connected." && <CheckCircle2 aria-hidden className="size-4 text-primary" />}{notice}</p>}
      <div className="grid items-start gap-3 sm:grid-cols-3">
        {["Gmail", "Calendar", "Drive"].map((g) => (
          <fieldset key={g} className="min-w-0 space-y-2.5 rounded-lg border bg-muted/20 p-3"><legend className="sr-only">{g}</legend>
            <div className="flex items-center gap-2" aria-hidden>{(() => { const G = GROUPS[g]; return <G.icon className={`size-4 shrink-0 ${G.color}`} />; })()}<div className="min-w-0"><p className="text-xs font-medium leading-none">{g}</p><p className="mt-1 truncate text-xs text-muted-foreground">{GROUPS[g].hint}</p></div></div>
            {SCOPES.filter((s) => s.group === g).map((s) => <Check key={s.id} checked={scopes.has(s.id)} onChange={(on) => toggle(s.id, on)}>{s.label}</Check>)}
          </fieldset>))}
      </div>
      <Check checked={allowSend} disabled={!scopes.has("gmail.send")} onChange={setAllowSend}>Allow bots to send email without asking (off by default; drafts are safer)</Check>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void connect()} loading={busy} disabled={busy || (scopes.size === 0 && !connected)}>{connected ? <><ShieldCheck aria-hidden className="size-4" />Update permissions</> : <><GoogleLogo className="size-4" />Connect with Google</>}</Button>
        {connected && <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}>Disconnect</Button>}
      </div>
    </div>
  );
}

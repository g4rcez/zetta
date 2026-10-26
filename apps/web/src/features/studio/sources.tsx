import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";
import { Empty, field, useList } from "../shared/ui";

type Source = { id: string; kind: "rss" | "web" | "email" | "x"; url: string; label: string; lastStatus: "ok" | "failed" | "blocked" | null; lastFetchedAt: string | null };
type Briefing = { parts: { label: string; status: string }[]; prompt: string; gaps: string[] };

const MAIL_PRESETS = [
  { id: "gmail", name: "Gmail", host: "imap.gmail.com", help: "Turn on 2-step verification, then create an App password at myaccount.google.com/apppasswords and paste it here." },
  { id: "outlook", name: "Outlook / Microsoft 365", host: "outlook.office365.com", help: "Use an app password from your Microsoft account security page." },
  { id: "icloud", name: "iCloud Mail", host: "imap.mail.me.com", help: "Create an app-specific password at appleid.apple.com." },
  { id: "yahoo", name: "Yahoo Mail", host: "imap.mail.yahoo.com", help: "Generate an app password in Yahoo account security." },
  { id: "custom", name: "Other (IMAP)", host: "", help: "Use your provider's IMAP host and an app password or mailbox password." },
] as const;

/** Sources you follow: public feeds and pages, plus your own mailbox (IMAP) and X. Used by "Read my sources" workflow steps. */
export function Sources({ onError }: { onError: (m: string) => void }) {
  const [rows, reload] = useList<Source>("/api/sources", "sources", onError);
  const [briefing, setBriefing] = useState<Briefing>();
  const [kind, setKind] = useState<"rss" | "web" | "email" | "x">("rss");
  const [preset, setPreset] = useState<(typeof MAIL_PRESETS)[number]["id"]>("gmail");
  const mail = MAIL_PRESETS.find((p) => p.id === preset)!;
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    try {
      if (kind === "email" || kind === "x") {
        // The secret goes straight into the sealed connections store; the source keeps only a reference to it.
        const provider = kind;
        const label = String(f.get("label"));
        const { connection } = await call<{ connection: { id: string } }>("/api/connections", "POST", { provider, label: `${label} (${provider === "email" ? "mailbox" : "X"})`, secret: String(f.get("secret")) });
        if (kind === "email") await call("/api/sources", "POST", { kind, label, connectionId: connection.id, host: preset === "custom" ? String(f.get("host")) : mail.host, user: String(f.get("user")), mailbox: String(f.get("mailbox") || "INBOX") });
        else await call("/api/sources", "POST", { kind, label, connectionId: connection.id, mode: String(f.get("mode")), value: String(f.get("value")) });
      } else await call("/api/sources", "POST", { kind, url: f.get("url"), label: f.get("label") });
      form.reset(); void reload();
    } catch (x) { onError(errorMessage(x)); }
  }
  return (
    <section aria-label="Sources" className="space-y-3 rounded-lg border bg-card p-5">
      <h2 className="font-medium">Sources you follow</h2>
      <p className="text-xs text-muted-foreground">Feeds and pages are public. Email and X use your own account: the password or token is stored encrypted and is never shown again; the app only reads (it never sends, deletes or marks mail as read).</p>
      <form onSubmit={(e) => void add(e)} className="grid gap-2 sm:grid-cols-2" aria-label="Add a source">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Type" className={field}><option value="rss">Feed (RSS/Atom)</option><option value="web">Web page</option><option value="email">Email (Gmail, Outlook, iCloud, any IMAP)</option><option value="x">X (timeline or search)</option></select>
        <input name="label" required maxLength={100} aria-label="Name" placeholder="Name" className={field} />
        {(kind === "rss" || kind === "web") && <input name="url" type="url" required aria-label="Address" placeholder="https://example.com/feed" className={`${field} sm:col-span-2`} />}
        {kind === "email" && <>
          <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} aria-label="Mail provider" className={field}>{MAIL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {preset === "custom" ? <input name="host" required aria-label="IMAP host" placeholder="imap.example.com" className={field} /> : <input aria-label="IMAP host" value={mail.host} readOnly className={field} />}
          <input name="user" type="email" required aria-label="Email address" placeholder="you@example.com" autoComplete="off" className={field} />
          <input name="mailbox" aria-label="Mailbox or label" placeholder="INBOX (or a label such as Newsletters)" className={field} />
          <input name="secret" type="password" required aria-label="App password" placeholder="App password" autoComplete="new-password" className={`${field} sm:col-span-2`} />
          <p className="text-xs text-muted-foreground sm:col-span-2">{mail.help}</p>
        </>}
        {kind === "x" && <>
          <select name="mode" aria-label="What to follow" className={field}><option value="user">A user's posts</option><option value="search">A search query</option></select>
          <input name="value" required aria-label="Handle or query" placeholder="@handle or a search query" className={field} />
          <input name="secret" type="password" required aria-label="X API bearer token" placeholder="X API bearer token" autoComplete="new-password" className={`${field} sm:col-span-2`} />
          <p className="text-xs text-muted-foreground sm:col-span-2">Create a project at developer.x.com and paste its bearer token. Reading requires an X API plan that allows it.</p>
        </>}
        <Button size="sm" type="submit" className="justify-self-start">Add</Button>
      </form>
      {rows?.length === 0 && <Empty>No sources yet.</Empty>}
      <ul className="space-y-1">{rows?.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm"><span className="min-w-0 truncate">{s.label} <span className="text-muted-foreground">· {s.kind === "rss" ? "feed" : s.kind === "web" ? "page" : s.kind === "email" ? "mailbox" : "X"} · {s.lastStatus ? (s.lastStatus === "ok" ? "read fine" : s.lastStatus === "blocked" ? "blocked address" : "could not be read") : "not read yet"}</span></span>
          <Button size="sm" variant="outline" onClick={() => void call(`/api/sources/${s.id}`, "DELETE").then(reload, (x) => onError(errorMessage(x)))}>Remove</Button></li>))}</ul>
      <Button size="sm" variant="outline" onClick={() => void call<Briefing>("/api/sources/briefing", "POST", {}).then(setBriefing, (x) => onError(errorMessage(x)))}>Preview briefing</Button>
      {briefing && <div role="status" className="rounded bg-muted p-2 text-xs"><p>{briefing.gaps.length ? `Could not read: ${briefing.gaps.join(", ")}.` : "All sources read."}</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{briefing.prompt.slice(0, 2000)}</pre></div>}
    </section>
  );
}

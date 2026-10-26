import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { ApiError, call, errorMessage } from "../chat/chat-client";
import { Markdown } from "../chat/markdown";
import { ConfirmButton, Empty, useList } from "../shared/ui";

type Snap = { id: string; title: string; botName: string; createdAt: string; ownerUserId?: string };
type Part = { seq: number; role: string; author?: string; content: string; thread?: number; attachments?: string[]; reactions?: Record<string, number> };
type Full = { title: string; botName: string; content: Part[]; ownerUserId?: string; createdAt: string; revokedAt: string | null };

export function Snapshots({ onError }: { onError: (m: string) => void }) {
  const [rows, reload] = useList<Snap>("/api/snapshots", "snapshots", onError);
  const [open, setOpen] = useState<{ id: string; snap?: Full; gone?: boolean }>();
  const [me, setMe] = useState<string>();
  async function view(id: string) {
    setOpen({ id });
    try { const r = await call<{ snapshot: Full }>(`/api/snapshots/${id}`); setOpen({ id, snap: r.snapshot }); }
    catch (e) { if (e instanceof ApiError && e.status === 404) setOpen({ id, gone: true }); else { setOpen(undefined); onError(errorMessage(e, "Could not open it.")); } }
  }
  async function revoke(id: string) {
    try { await call(`/api/snapshots/${id}`, "DELETE"); await view(id); await reload(); } catch (e) { onError(errorMessage(e)); }
  }
  useEffect(() => { authClient.getSession().then((r) => setMe(r.data?.user.id), () => {}); }, []);
  const s = open?.snap;
  return (
    <section aria-label="Team snapshots" className="space-y-3">
      {rows?.length === 0 && <Empty>No one has published a conversation yet. Publish one from Chat.</Empty>}
      <ul className="space-y-1">{rows?.map((r) => <li key={r.id}><button className="w-full min-w-0 break-words rounded-md border bg-card p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring" aria-current={open?.id === r.id} onClick={() => void view(r.id)}>{r.title} · {r.botName} · {new Date(r.createdAt).toLocaleDateString()}</button></li>)}</ul>
      {open?.gone && <p role="status" className="rounded-lg border bg-card p-4 text-sm">This snapshot is no longer available. It may have been taken down by its owner.</p>}
      {open && !open.snap && !open.gone && <p role="status" className="text-sm">Loading…</p>}
      {s && (
        <article aria-label={s.title} className="min-w-0 space-y-2 rounded-lg border bg-card p-4 text-sm">
          <h2 className="font-medium">{s.title} <span className="font-normal text-muted-foreground">· with {s.botName}</span></h2>
          <p role="note" className="rounded bg-muted p-2 text-xs">Read-only copy published {new Date(s.createdAt).toLocaleString()}. Later messages in the original chat are not part of it.</p>
          {s.revokedAt && <p role="alert" className="text-destructive">This snapshot was taken down on {new Date(s.revokedAt).toLocaleString()} and is no longer shared.</p>}
          {!s.revokedAt && (
            <ol className="space-y-2">{s.content.map((p) => (
              <li key={p.seq} className="min-w-0 rounded-md border bg-card p-3">
                <p className="text-xs font-semibold">#{p.seq} {p.role === "user" ? "User" : (p.author ?? "Bot")}{p.thread ? <span className="font-normal"> · ↳ reply to #{p.thread}</span> : null}</p>
                <div className="min-w-0 break-words"><Markdown source={p.content} /></div>
                {p.attachments?.length ? <p className="text-xs text-muted-foreground">Attached files (names only): {p.attachments.join(", ")}</p> : null}
                {p.reactions && Object.keys(p.reactions).length ? <p className="text-xs">{Object.entries(p.reactions).map(([e, n]) => `${e} ${n}`).join("  ")}</p> : null}
              </li>))}</ol>)}
          {!s.revokedAt && me && s.ownerUserId === me && <div className="pt-1"><ConfirmButton label="Take down" question="Stop sharing this snapshot with your team?" confirmLabel="Take down" onConfirm={() => revoke(open!.id)} /></div>}
        </article>)}
    </section>
  );
}

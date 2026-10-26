import { useState } from "react";
import { Button } from "@/components/ui";

import { refreshAttention } from "../attention/summary";
import { call, errorMessage, type Bot } from "../chat/chat-client";
import { Empty, useList, when } from "../shared/ui";

type Status = "open" | "acknowledged" | "resolved" | "cancelled";
type Action = "read" | "acknowledge" | "resolve" | "cancel" | "reopen";
type Item = { id: string; title: string; detail: string; nextAction: string; resultLink: string | null; status: Status; occurrences: number; readAt: string | null; completed: string; remaining: string; botId: string | null; updatedAt?: string };

const COLUMNS: { status: Exclude<Status, "cancelled">; label: string; hint: string }[] = [
  { status: "open", label: "Needs you", hint: "Something is waiting for you. It stays here until you act on it." },
  { status: "acknowledged", label: "Seen", hint: "You have seen it. Seeing it does not fix anything." },
  { status: "resolved", label: "Resolved", hint: "You marked it as dealt with." },
];
/** Only a safe, same-purpose link: web addresses or paths inside the app. */
const safeLink = (l: string) => /^(https?:\/\/|\/)/.test(l) && !l.startsWith("//");

function Card({ item, botName, busy, onAction }: { item: Item; botName?: string | undefined; busy: boolean; onAction: (a: Action) => void }) {
  const unread = !item.readAt && item.status === "open";
  const btn = (label: string, action: Action, variant: "outline" | "default" = "outline") => <Button size="sm" variant={variant} disabled={busy} onClick={() => onAction(action)}>{label}</Button>;
  return (
    <article className="min-w-0 space-y-1 rounded-md border bg-card p-3 text-sm" aria-label={item.title}>
      <p className={unread ? "font-bold" : "font-medium"}>{unread && <span className="mr-1 inline-block size-2 rounded-full bg-destructive align-middle" aria-hidden />}{item.title}{unread && <span className="sr-only"> (unread)</span>}</p>
      {botName && <p className="text-xs text-muted-foreground">From {botName}</p>}
      {item.occurrences > 1 && <p className="text-xs">Happened {item.occurrences} times</p>}
      {item.detail && <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.detail.slice(0, 300)}</p>}
      {item.completed && <p className="break-words"><span className="font-medium">Done so far:</span> {item.completed}</p>}
      {item.remaining && <p className="break-words"><span className="font-medium">Still to do:</span> {item.remaining}</p>}
      {item.nextAction && <p className="break-words">Next: {item.nextAction}</p>}
      {item.resultLink && safeLink(item.resultLink) && <a className="underline" href={item.resultLink}>Open result</a>}
      <div className="flex flex-wrap gap-1 pt-1">
        {item.status === "open" && <>{unread && btn("Mark as read", "read")}{btn("I've seen this", "acknowledge")}{btn("Resolve", "resolve")}</>}
        {item.status === "acknowledged" && <>{btn("Resolve", "resolve")}{btn("Reopen", "reopen")}</>}
        {(item.status === "resolved" || item.status === "cancelled") && btn("Reopen", "reopen")}
        {item.status !== "cancelled" && item.status !== "resolved" && btn("Dismiss", "cancel")}
      </div>
    </article>
  );
}

export function Attention({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const [rows, reload] = useList<Item>("/api/attention", "items", onError);
  const [busy, setBusy] = useState<string>();
  const [showCancelled, setShowCancelled] = useState(false);
  async function act(id: string, action: Action) {
    setBusy(id);
    try { await call(`/api/attention/${id}/action`, "POST", { action }); await reload(); void refreshAttention(); } catch (e) { onError(errorMessage(e, "Could not update the card.")); } finally { setBusy(undefined); }
  }
  const nameOf = (id: string | null) => (id ? bots.find((b) => b.id === id)?.name : undefined);
  const cancelled = rows?.filter((i) => i.status === "cancelled") ?? [];
  return (
    <section aria-label="Attention" className="space-y-4">
      <p className="text-sm text-muted-foreground">Things bots and routines want you to look at. Marking something as seen only hides the alert; it does not fix the problem.</p>
      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((c) => {
          const items = rows?.filter((i) => i.status === c.status) ?? [];
          return (
            <div key={c.status} className="min-w-0 space-y-2" role="group" aria-label={`${c.label} (${items.length})`}>
              <h2 className="text-xs font-semibold uppercase">{c.label} <span className="font-normal">({items.length})</span></h2>
              <p className="text-xs text-muted-foreground">{c.hint}</p>
              {items.map((i) => <Card key={i.id} item={i} botName={nameOf(i.botId)} busy={busy === i.id} onAction={(a) => void act(i.id, a)} />)}
              {rows && items.length === 0 && <Empty>Nothing here.</Empty>}
            </div>);
        })}
      </div>
      <div>
        <Button size="sm" variant="outline" aria-expanded={showCancelled} onClick={() => setShowCancelled(!showCancelled)}>{showCancelled ? "Hide" : "Show"} dismissed ({cancelled.length})</Button>
        {showCancelled && <div className="mt-2 grid gap-2 md:grid-cols-3">{cancelled.map((i) => <Card key={i.id} item={i} botName={nameOf(i.botId)} busy={busy === i.id} onAction={(a) => void act(i.id, a)} />)}{cancelled.length === 0 && <Empty>No dismissed items.</Empty>}</div>}
      </div>
      {rows?.some((i) => i.updatedAt) && <p className="text-xs text-muted-foreground">Last change {when(rows.reduce((a, i) => ((i.updatedAt ?? "") > a ? (i.updatedAt ?? a) : a), ""))}</p>}
    </section>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { Plus, ShieldAlert, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@zetta/ui/components/badge";
import { cn } from "@zetta/ui/lib/utils";
import { Button, Checkbox, Input, Textarea } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { chatClient, errorMessage, type Bot, type Message, type Proposal } from "../chat/chat-client";
import type { Row } from "../chat/chat-rows";
import { MessageList } from "../chat/message-list";
import type { Author } from "../chat/message-row";
import { ProposalsPanel } from "../chat/proposals-panel";
import { discussionsApi, STATUS_LABEL, type DiscussionDetail, type DiscussionListItem, type DiscussionStatus } from "./discussions-api";

const STATUS_CLASS: Record<DiscussionStatus, string> = { open: "bg-sky-500/15 text-sky-700 dark:text-sky-300", paused: "bg-muted text-muted-foreground", stalled: "bg-amber-500/15 text-amber-700 dark:text-amber-300", resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", cancelled: "bg-muted text-muted-foreground" };
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const closed = (s: DiscussionStatus) => s === "resolved" || s === "cancelled";

/** Group discussions between bots: the list, one discussion's shared context and transcript, and a form to start one yourself. */
export function DiscussionsPage({ selectedId }: { selectedId?: string | undefined }) {
  const navigate = useNavigate();
  const [list, setList] = useState<DiscussionListItem[]>();
  const [bots, setBots] = useState<Bot[]>([]);
  const [creating, setCreating] = useState(false);
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);
  const reloadList = useCallback(() => discussionsApi.list().then(setList, (e) => { setList((x) => x ?? []); fail(e); }), [fail]);
  useEffect(() => { void reloadList(); chatClient.bots().then(setBots, fail); }, [reloadList, fail]);
  const live = list?.some((d) => d.running || d.queued > 0);
  // Bots work in the background: refresh often while one is working, slowly otherwise.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void reloadList(); }, live ? 3000 : 15_000);
    return () => clearInterval(t);
  }, [live, reloadList]);
  const select = (id?: string) => { setCreating(false); void navigate({ to: "/discussions", search: id ? { id } : {} }); };

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[20rem_minmax(0,1fr)]">
      <aside aria-label="Discussions" className={cn("flex min-h-0 flex-col border-r bg-sidebar", (selectedId || creating) && "hidden md:flex")}>
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <h1 className="text-base font-semibold">Discussions</h1>
          <Button size="sm" onClick={() => { setCreating(true); void navigate({ to: "/discussions", search: {} }); }}><Plus className="size-4" aria-hidden="true" />New</Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {!list && <li role="status" className="p-2 text-sm text-muted-foreground">Loading…</li>}
          {list?.length === 0 && <li className="p-3 text-sm text-muted-foreground">No discussions yet. Bots open one when a task needs other bots, or start one yourself.</li>}
          {list?.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => select(d.id)} aria-current={d.id === selectedId ? "true" : undefined}
                className={cn("w-full space-y-1 rounded-md p-2 text-left text-sm hover:bg-sidebar-accent", d.id === selectedId && "bg-sidebar-accent")}>
                <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{d.title}</span><span className="shrink-0 text-xs text-muted-foreground">{ago(d.updatedAt)}</span></span>
                <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span className={cn("rounded px-1.5 py-0.5 font-medium", STATUS_CLASS[d.status])}>{d.awaitingApproval ? "Waiting for you" : d.running ? "Bot working…" : STATUS_LABEL[d.status]}</span>
                  <span className="truncate">{d.members.map((m) => m.name).join(", ")}</span>
                </span>
              </button>
            </li>))}
        </ul>
      </aside>
      <main className="flex min-h-0 flex-col">
        {creating ? <NewDiscussion bots={bots} onCancel={() => setCreating(false)} onCreated={(id) => { void reloadList(); select(id); }} />
          : selectedId ? <DiscussionView key={selectedId} id={selectedId} bots={bots} onBack={() => select()} onChanged={() => void reloadList()} />
          : <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground"><div className="space-y-2"><UsersRound className="mx-auto size-8" aria-hidden="true" /><p>Pick a discussion to follow what the bots are doing.</p></div></div>}
      </main>
    </div>
  );
}

function DiscussionView({ id, bots, onBack, onChanged }: { id: string; bots: Bot[]; onBack: () => void; onChanged: () => void }) {
  const { data: session } = authClient.useSession();
  const [detail, setDetail] = useState<DiscussionDetail>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [briefs, setBriefs] = useState<Proposal[]>([]);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);
  const load = useCallback(async () => {
    try {
      const d = await discussionsApi.get(id);
      setDetail(d);
      setMessages(await chatClient.messages(d.discussion.conversationId));
      setBriefs((await chatClient.proposals()).filter((p) => p.kind === "discussion_brief" && p.patch?.discussionId === id));
    } catch (e) { fail(e); }
  }, [id, fail]);
  useEffect(() => { void load(); }, [load]);
  const working = detail?.turns.some((t) => t.status === "running" || t.status === "queued");
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, working ? 2000 : 10_000);
    return () => clearInterval(t);
  }, [working, load]);

  const me: Author = { name: session?.user.name ?? "You", image: session?.user.image };
  const authorOf = useCallback((row: Row): Author => {
    if (row.role === "user") return me;
    if (row.role === "system") return { name: "Zetta" };
    const bot = bots.find((b) => b.id === row.botId);
    return { name: bot?.name ?? row.botName ?? "Bot", bot };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bots, session?.user.name, session?.user.image]);
  const rows = useMemo<Row[]>(() => messages.map((m) => ({ ...m, createdAt: m.createdAt ?? new Date().toISOString(), streaming: m.status === "running" })), [messages]);

  async function act(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try { await work(); if (done) toast.success(done); await load(); onChanged(); } catch (e) { fail(e); }
    setBusy(false);
  }
  if (!detail) return <p role="status" className="p-6 text-sm text-muted-foreground">Loading…</p>;
  const d = detail.discussion, isClosed = closed(d.status);
  const running = detail.turns.find((t) => t.status === "running");
  const names = new Map(detail.members.map((m) => [m.botId, m.name]));

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section aria-label="Transcript" className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Button size="sm" variant="ghost" className="md:hidden" onClick={onBack}>Back</Button>
          <h2 className="mr-auto truncate text-base font-semibold">{d.title}</h2>
          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_CLASS[d.status])}>{STATUS_LABEL[d.status]}</span>
          <span className="text-xs text-muted-foreground" title="Bot turns used of the budget">{d.turnsUsed}/{d.turnBudget} turns</span>
          {!isClosed && (d.status === "open"
            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => discussionsApi.act(id, "pause"))}>Pause</Button>
            : <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => discussionsApi.act(id, "resume"))}>Resume</Button>)}
          {!isClosed && <Button size="sm" variant="outline" disabled={busy} onClick={() => { const summary = window.prompt("What was the outcome?"); if (summary?.trim()) void act(() => discussionsApi.resolve(id, summary.trim()), "Resolved."); }}>Resolve</Button>}
          {!isClosed && <Button size="sm" variant="destructive" disabled={busy} onClick={() => { if (window.confirm("Cancel this discussion? Queued bot turns are dropped.")) void act(() => discussionsApi.act(id, "cancel")); }}>Cancel</Button>}
        </header>
        {briefs.length > 0 && <div className="space-y-2 border-b p-3"><ProposalsPanel proposals={briefs} bots={bots} notify={(m) => toast(m)} onResolved={() => void load()} onBotsChanged={() => void load()} /></div>}
        <MessageList rows={rows} authorOf={authorOf} busy={Boolean(working)} label="Discussion transcript" inThread
          actions={{ onReact: (row, emoji) => void chatClient.react(row.id, emoji).then(load, fail), onReply: () => {}, onSaveInstruction: (row) => void chatClient.saveInstruction(d.title, row.content).then(() => toast.success("Saved as an instruction."), fail) }}
          footer={running ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">{names.get(running.botId) ?? "A bot"} is working…</p> : null} />
        {!isClosed && (
          <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); const text = draft.trim(); if (!text) return; void act(async () => { await discussionsApi.post(id, text); setDraft(""); }); }}>
            <Textarea title="Message the group" hiddenLabel container="flex-1" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Mention a bot to ask it, e.g. @${detail.members[0]?.name.replace(/\s+/g, "") ?? "Bot"}`} />
            <Button type="submit" disabled={busy || !draft.trim()}>Send</Button>
          </form>)}
      </section>
      <aside aria-label="Task context" className="max-h-[45%] space-y-4 overflow-y-auto border-t p-4 text-sm lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l">
        {d.tainted && <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs"><ShieldAlert className="size-4 shrink-0 text-amber-600" aria-hidden="true" />This discussion includes outside content{d.originInbound ? ` (from ${d.originInbound.chatName})` : ""}. Bots that can change code wait for you to approve the brief.</p>}
        <div className="space-y-1"><h3 className="text-xs font-semibold uppercase text-muted-foreground">Goal</h3><p className="whitespace-pre-wrap">{d.goal || "(not set)"}</p></div>
        {d.summary && <div className="space-y-1"><h3 className="text-xs font-semibold uppercase text-muted-foreground">Outcome</h3><p className="whitespace-pre-wrap">{d.summary}</p></div>}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Shared context <span className="font-normal normal-case">v{d.contextVersion}</span></h3>
          {context === undefined
            ? <><p className="whitespace-pre-wrap break-words">{d.context || "(empty)"}</p>{!isClosed && <Button size="sm" variant="outline" onClick={() => setContext(d.context)}>Edit</Button>}</>
            : <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void act(async () => { await discussionsApi.update(id, d.version, { context }); setContext(undefined); }, "Context saved."); }}>
              <Textarea title="Shared context" hiddenLabel rows={8} value={context} maxLength={8000} onChange={(e) => setContext(e.target.value)} />
              <p className="text-xs text-muted-foreground">Changing it asks again before a code bot acts on outside content.</p>
              <div className="flex gap-2"><Button size="sm" type="submit" disabled={busy}>Save</Button><Button size="sm" variant="ghost" type="button" onClick={() => setContext(undefined)}>Discard</Button></div>
            </form>}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Bots</h3>
          <ul className="space-y-2">{detail.members.map((m) => (
            <li key={m.botId} className="space-y-1">
              <div className="flex items-center gap-2"><span className="font-medium">{m.name}</span>{m.botId === d.createdByBotId && <Badge variant="secondary" className="h-4 px-1 text-[10px]">Facilitator</Badge>}{m.code && <Badge variant="outline" className="h-4 px-1 text-[10px]">Code</Badge>}<span className="ml-auto text-xs text-muted-foreground">{m.turns} turns</span></div>
              {m.role && <p className="text-xs text-muted-foreground">{m.role}</p>}
              {m.code && d.tainted && <Checkbox checked={m.requireApproval} disabled={busy || isClosed} onChange={(e) => void act(() => discussionsApi.setApproval(id, m.botId, e.target.checked))}>Ask me before it acts</Checkbox>}
            </li>))}</ul>
        </div>
        {d.originConversationId && <a className="block text-xs text-primary hover:underline" href={`/chat/${d.originConversationId}`}>Open the chat that started it</a>}
      </aside>
    </div>
  );
}

function NewDiscussion({ bots, onCancel, onCreated }: { bots: Bot[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const ready = bots.filter((b) => b.onboarded);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    setBusy(true);
    try {
      const d = await discussionsApi.create({ title: String(f.get("title") ?? ""), goal: String(f.get("goal") ?? ""), context: String(f.get("context") ?? ""), members: picked.map((bot) => ({ bot })), firstMessage: String(f.get("first") ?? "") });
      onCreated(d.id);
    } catch (e) { toast.error(errorMessage(e)); }
    setBusy(false);
  }
  return (
    <form className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-4 md:p-8" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
      <div className="space-y-1"><h2 className="text-lg font-semibold">New discussion</h2><p className="text-sm text-muted-foreground">Bring bots together on one task. They see the goal and the shared context, hand work to each other with @mentions, and resolve it when done.</p></div>
      <Input title="Title" name="title" required maxLength={120} placeholder="e.g. Login crash reported by a customer" autoFocus />
      <Textarea title="Goal" name="goal" required={false} rows={2} maxLength={1000} placeholder="What done looks like" />
      <Textarea title="Shared context" name="context" required={false} rows={5} maxLength={8000} placeholder="Everything the bots need: who asked, what happened, links, ids" />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Bots (up to 5)</legend>
        {ready.length === 0 ? <p className="text-xs text-muted-foreground">No ready bots yet.</p>
          : ready.map((b) => <Checkbox key={b.id} checked={picked.includes(b.id)} disabled={!picked.includes(b.id) && picked.length >= 5} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))}>{b.name}</Checkbox>)}
      </fieldset>
      <Textarea title="First message" name="first" required rows={3} maxLength={4000} placeholder="Mention who should start, e.g. @Dev please look at the crash. Without a mention, every bot answers once." />
      <div className="flex gap-2"><Button type="submit" disabled={busy || picked.length === 0}>Start discussion</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

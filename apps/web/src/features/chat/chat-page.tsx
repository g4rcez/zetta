import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Eye, Menu, FolderOpen, Paperclip, Share2, SlidersHorizontal, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui";

import { BotAvatar } from "@/components/bot-avatar";

import { refreshAttention } from "../attention/summary";
import { BotSettings } from "./bot-settings";
import { cancelTurn, chatClient, errorMessage, listFiles, streamTurn, uploadAttachment, type Attachment, type Bot, type Conversation, type Message, type Proposal, type Workspace } from "./chat-client";
import { Markdown } from "./markdown";
import { MessageItem } from "./message-item";
import { ProposalsPanel } from "./proposals-panel";
import { PublishDialog } from "./publish-dialog";
import { toggleReaction } from "./reactions";
import { ChatSidebar } from "./sidebar";

type Live = { botId: string; botName?: string | undefined; text: string };

export function ChatPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState<string>();
  const [chats, setChats] = useState<Conversation[]>([]);
  const [chatId, setChatId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<Live>();
  const [summary, setSummary] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [replyTo, setReplyTo] = useState<Message>();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [picker, setPicker] = useState<{ path: string; entries: { name: string; kind: "file" | "dir" }[] }>();
  const [publishing, setPublishing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // phones: the bot/chat list replaces the conversation while open
  const end = useRef<HTMLDivElement>(null);
  const pendingChat = useRef<string | null>(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("c"));
  const fail = (e: unknown) => setError(errorMessage(e));

  const loadProposals = useCallback(() => chatClient.proposals().then(setProposals).catch(() => {}), []);
  useEffect(() => { void loadProposals(); }, [loadProposals]);
  useEffect(() => { chatClient.workspaces().then(setSpaces).catch(fail); }, []);
  useEffect(() => {
    chatClient.bots().then((list) => { setBots(list); setBotId((prev) => prev ?? (list.find((b) => b.kind === "chief") ?? list[0])?.id); }).catch(fail);
  }, []);
  // A link like /chat?c=<conversationId> opens that conversation (and its bot).
  useEffect(() => {
    const wanted = pendingChat.current;
    if (!wanted) return;
    chatClient.conversations().then((all) => { const found = all.find((c) => c.id === wanted); if (found) setBotId(found.botId); else pendingChat.current = null; }).catch(() => { pendingChat.current = null; });
  }, []);
  const loadChats = useCallback((id: string) => chatClient.conversations(id).then((list) => {
    setChats(list);
    const wanted = pendingChat.current;
    if (wanted && list.some((c) => c.id === wanted)) { pendingChat.current = null; setChatId(wanted); } else setChatId(list[0]?.id);
  }).catch(fail), []);
  useEffect(() => { if (botId) void loadChats(botId); }, [botId, loadChats]);
  useEffect(() => { if (chatId) chatClient.messages(chatId).then(setMessages).catch(fail); else setMessages([]); setSummary(undefined); }, [chatId]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages, streaming]);

  const current = bots.find((b) => b.id === botId);
  const replaceBot = (bot: Bot) => setBots((list) => list.map((b) => (b.id === bot.id ? { ...b, ...bot, canEdit: b.canEdit } : b)));
  const refreshBots = () => chatClient.bots().then(setBots).catch(() => {});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !botId || busy) return;
    setBusy(true); setError(undefined); setSummary(undefined);
    try {
      let id = chatId;
      if (!id) { const created = await chatClient.startConversation(botId); id = created.id; setChats((c) => [created, ...c]); setChatId(id); }
      const live = new Map<string, string>(); // streaming bubbles keyed by bot id
      await streamTurn(id, { clientRequestId: crypto.randomUUID(), content, ...(replyTo ? { parentMessageId: replyTo.id } : {}), ...(attached.length ? { attachmentIds: attached.map((x) => x.id) } : {}), ...(fileRefs.length ? { fileRefs } : {}) }, (ev) => {
        if (ev.type === "user") setMessages((m) => [...m, { ...ev.message, attachments: attached }]);
        if (ev.type === "start" && ev.botId) setStreaming({ botId: ev.botId, botName: ev.botName, text: "" });
        if (ev.type === "delta") { live.set(ev.botId, (live.get(ev.botId) ?? "") + ev.text); setStreaming((s) => ({ botName: s?.botId === ev.botId ? s.botName : undefined, botId: ev.botId, text: live.get(ev.botId)! })); }
        if (ev.type === "message") { live.delete(ev.message.botId ?? ""); setStreaming(undefined); setMessages((m) => [...m, ev.message]); }
        if (ev.type === "summary") setSummary(ev.text);
        if (ev.type === "proposal") void loadProposals();
        if (ev.type === "error") setError("The reply was interrupted.");
      });
      setDraft(""); setPreviewing(false); setReplyTo(undefined); setAttached([]); setFileRefs([]);
      void refreshAttention();
    } catch (e) { fail(e); } finally { setBusy(false); setStreaming(undefined); }
  }
  async function addBot(name: string) {
    try { const bot = await chatClient.createBot({ name }); setBots((b) => [...b, bot]); setBotId(bot.id); } catch (e) { fail(e); }
  }
  const hasReply = messages.some((m) => m.role === "assistant" && m.status === "complete");
  async function answer(satisfied: boolean) {
    if (!current || !chatId) return;
    try { const q = await chatClient.askOnboarding(current.id, chatId); replaceBot(await chatClient.answerOnboarding(current.id, { conversationId: chatId, questionId: q.questionId, expectedVersion: current.version, satisfied })); void chatClient.messages(chatId).then(setMessages).catch(() => {}); setNotice(satisfied ? "Great, this bot is ready for work." : "Okay. Adjust the settings, then chat again to retest."); } catch (e) { fail(e); }
  }
  const setReactions = (id: string, reactions: Message["reactions"]) => setMessages((l) => l.map((m) => (m.id === id ? { ...m, reactions } : m)));
  async function toggleReact(m: Message, emoji: string) {
    const before = m.reactions ?? [], wasMine = before.some((r) => r.emoji === emoji && r.mine);
    setReactions(m.id, toggleReaction(before, emoji));
    try { await (wasMine ? chatClient.unreact(m.id, emoji) : chatClient.react(m.id, emoji)); }
    catch (e) { setReactions(m.id, before); fail(e); }
  }

  const attachBtn = "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-within:outline-2 focus-within:outline-ring";
  return (
    <div className="grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[20rem_minmax(0,1fr)]">
      <div className={`${navOpen ? "flex" : "hidden"} min-h-0 md:flex`}>
        <ChatSidebar bots={bots} spaces={spaces} chats={chats} botId={botId} chatId={chatId} onBot={(id) => { setBotId(id); setNavOpen(false); }} onChat={(id) => { setChatId(id); setNavOpen(false); }} onNewChat={() => { setChatId(undefined); setMessages([]); setNavOpen(false); }}
          onAddBot={(n) => void addBot(n)} onAddSpace={(name, parentId) => void chatClient.createWorkspace(name, parentId).then((w) => setSpaces((s) => [...s, w]), fail)} />
      </div>
      <section className={`${navOpen ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-col`} aria-label={current ? `Chat with ${current.name}` : "Chat"}>
        <header className="flex items-center gap-3 border-b px-4 py-2.5">
          <Button size="icon" variant="ghost" className="md:hidden" aria-label="Bots and chats" onClick={() => setNavOpen(true)}><Menu /></Button>
          {current && <BotAvatar id={current.id} size={36} />}
          <div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold leading-tight">{current?.name ?? "Chat"}</h2>
            <p className="truncate text-xs text-muted-foreground">{current ? (current.description || (current.kind === "chief" ? "Your chief of staff" : "Specialist")) : "Loading bots…"}</p></div>
          {current && <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} aria-label="Bot settings" className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <Sparkles aria-hidden="true" className="size-4 text-primary" /><span className="hidden max-w-56 truncate sm:inline">{current.harness === "fixture" ? "Offline test" : `${current.harness}${current.model ? ` · ${current.model}` : ""}`}</span><SlidersHorizontal aria-hidden="true" className="size-4 text-muted-foreground" /></button>}
          {chatId && messages.length > 0 && <Button size="icon" variant="ghost" aria-label="Publish snapshot to team" title="Publish snapshot to team" onClick={() => setPublishing(true)}><Share2 /></Button>}
        </header>
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto" role="log" aria-live="polite">
              <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
                {messages.length === 0 && !streaming && (
                  <div className="grid place-items-center gap-3 py-20 text-center">
                    {current && <BotAvatar id={current.id} size={72} />}
                    <p className="text-lg font-medium">{current ? `Say hello to ${current.name}.` : "Loading bots…"}</p>
                    {current && current.canEdit && !current.onboarded && <p className="max-w-sm text-sm text-muted-foreground">{current.name} isn't ready yet: send a test message to start setup.</p>}
                  </div>)}
                {messages.map((m) => (
                  <MessageItem key={m.id} message={m} bots={bots} botId={botId} onReply={setReplyTo} onToggleReaction={(msg, e) => void toggleReact(msg, e)}
                    onSaveInstruction={(msg) => void chatClient.saveInstruction(`From chat: ${msg.content.slice(0, 40)}`, msg.content).then(() => setNotice("Saved to your instruction library."), fail)} />))}
                {streaming && (
                  <div role="status" aria-label="Bot is replying" className="min-w-0 max-w-[min(42rem,85%)] break-words rounded-xl rounded-bl-sm bg-card px-4 py-2.5 text-[15px] ring-1 ring-border">
                    {streaming.botId !== botId && <p className="mb-1 text-xs font-medium text-muted-foreground">{streaming.botName ?? bots.find((b) => b.id === streaming.botId)?.name ?? "Bot"} answers</p>}
                    {streaming.text ? <Markdown source={streaming.text} /> : <p className="flex items-center gap-1 text-muted-foreground">Thinking<span className="inline-flex gap-0.5" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 120}ms` }} />)}</span></p>}
                  </div>)}
                {summary && !streaming && <p className="max-w-prose text-xs text-muted-foreground" aria-label="Delegation summary">{summary}</p>}
                <div ref={end} />
              </div>
            </div>
            <div className="mx-auto w-full max-w-3xl space-y-2 px-4">
              <ProposalsPanel proposals={proposals} bots={bots} notify={setNotice} onResolved={(id) => setProposals((l) => l.filter((x) => x.id !== id))} onBotsChanged={() => void refreshBots()} />
              {current && current.canEdit && !current.onboarded && hasReply && (
                <div role="group" aria-label="Onboarding" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3">
                  <p>Are you satisfied with how {current.name} answers?</p>
                  <div className="flex gap-2"><Button size="sm" onClick={() => void answer(true)}>Yes, I'm satisfied</Button><Button size="sm" variant="outline" onClick={() => void answer(false)}>Not yet</Button></div>
                </div>)}
              <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm empty:hidden">{notice}</p>
              {replyTo && <p className="text-xs text-muted-foreground">Replying in thread to “{replyTo.content.slice(0, 40)}” <button type="button" className="underline" onClick={() => setReplyTo(undefined)}>cancel</button></p>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              {(attached.length > 0 || fileRefs.length > 0) && <p className="text-xs">{[...attached.map((a) => `📎 ${a.name}`), ...fileRefs.map((f) => `📁 ${f}`)].join(" · ")} <button type="button" className="underline" onClick={() => { setAttached([]); setFileRefs([]); }}>clear</button></p>}
              {picker && <div role="dialog" aria-label="Server files" className="rounded-lg border bg-card p-3 text-sm"><p className="font-medium">{picker.path}</p><ul>{picker.entries.map((en) => <li key={en.name}><button type="button" className="hover:underline" onClick={() => { const p = `${picker.path}/${en.name}`; if (en.kind === "dir") void listFiles(p).then((entries) => setPicker({ path: p, entries }), fail); else { setFileRefs((r) => [...r, p]); setPicker(undefined); } }}>{en.kind === "dir" ? "📂" : "📄"} {en.name}</button></li>)}{picker.entries.length === 0 && <li className="text-muted-foreground">Empty. Put files under the server's files folder.</li>}</ul><button type="button" className="mt-1 underline" onClick={() => setPicker(undefined)}>Close</button></div>}
              {previewing && <div aria-label="Message preview" className="max-h-40 min-w-0 overflow-y-auto break-words rounded-lg border bg-muted p-3 text-sm">{draft.trim() ? <Markdown source={draft} /> : <p className="text-muted-foreground">Nothing to preview yet.</p>}</div>}
            </div>
            <form onSubmit={submit} className="mx-auto w-full max-w-3xl px-4 pt-1 pb-4">
              <div className="flex items-end gap-1 rounded-xl border bg-card p-2 shadow-sm focus-within:border-ring/60">
                <label className={attachBtn} title="Attach text file"><Paperclip aria-hidden="true" className="size-5" /><span className="sr-only">Attach text file</span><input type="file" accept=".txt,.md,.json,.csv,.log,.ts,.js,.py,text/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { const att = await uploadAttachment(f.name, await f.text(), chatId); setAttached((a) => [...a, att]); } catch (x) { fail(x); } }} /></label>
                <button type="button" className={attachBtn} title="Server files" onClick={() => void listFiles("shared").then((entries) => setPicker({ path: "shared", entries }), fail)}><FolderOpen aria-hidden="true" className="size-5" /><span className="sr-only">Server files</span></button>
                <button type="button" className={`${attachBtn} ${previewing ? "bg-muted text-foreground" : ""}`} title={previewing ? "Hide preview" : "Preview"} aria-pressed={previewing} onClick={() => setPreviewing((p) => !p)}><Eye aria-hidden="true" className="size-5" /><span className="sr-only">{previewing ? "Hide preview" : "Preview"}</span></button>
                <textarea aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={current ? `Message ${current.name}` : "Message your bot"} rows={1}
                  className="field-sizing-content max-h-[40dvh] min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(e); } }} />
                {busy && chatId ? <Button type="button" size="icon-lg" variant="outline" aria-label="Stop" onClick={() => void cancelTurn(chatId).catch(fail)}><Square className="fill-current" /></Button> : null}
                <Button type="submit" size="icon-lg" aria-label={busy ? "Sending…" : "Send"} disabled={busy || !draft.trim() || !botId}><ArrowUp /></Button>
              </div>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">Type @BotName to bring another ready bot into the chat. Enter sends, Shift+Enter adds a line.</p>
            </form>
          </div>
          {settingsOpen && current && (
            <aside aria-label="Bot settings panel" className="absolute inset-y-0 right-0 z-20 w-full max-w-md overflow-y-auto border-l bg-background p-4 shadow-xl md:static md:w-[26rem] md:max-w-none md:shadow-none">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">{current.canEdit ? "Bot settings" : `Accounts for ${current.name}`}</h2><Button size="icon-sm" variant="ghost" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X /></Button></div>
              <BotSettings bot={current} bots={bots} spaces={spaces} onBotChange={replaceBot} notify={setNotice} />
            </aside>)}
        </div>
      </section>
      {publishing && chatId && <PublishDialog conversationId={chatId} onClose={() => setPublishing(false)} onPublished={() => { setPublishing(false); setNotice("Published a read-only copy for your team. Later messages are not included."); }} />}
    </div>
  );
}

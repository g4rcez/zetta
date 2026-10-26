import { Link } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";

import { BotAvatar } from "@/components/bot-avatar";
import { useAttentionSummary } from "../attention/summary";
import { field } from "../shared/ui";
import type { Bot, Conversation, Workspace } from "./chat-client";

function depthOf(spaces: Workspace[], id: string | null) {
  let d = 0, cur = spaces.find((w) => w.id === id);
  while (cur?.parentId && d < 5) { d++; cur = spaces.find((w) => w.id === cur!.parentId); }
  return d;
}

type Props = {
  bots: Bot[]; spaces: Workspace[]; chats: Conversation[]; botId?: string; chatId?: string;
  onBot: (id: string) => void; onChat: (id: string) => void; onNewChat: () => void;
  onAddBot: (name: string) => void; onAddSpace: (name: string, parentId?: string) => void;
};

const subtitle = (b: Bot) => b.description || (b.kind === "chief" ? "Your chief of staff" : b.harness === "fixture" ? "Offline test bot" : `${b.harness}${b.model ? ` · ${b.model}` : ""}`);

/** Rule: owners see their own unready bots with a setup hint and can still open them to finish setup; nobody else can chat with an unready team bot. */
function BotRow({ b, current, onBot }: { b: Bot; current: boolean; onBot: (id: string) => void }) {
  const blocked = !b.canEdit && !b.onboarded;
  const setup = b.canEdit && !b.onboarded;
  return (
    <button type="button" aria-current={current} aria-disabled={blocked || undefined} title={blocked ? "Its owner has to finish setting this bot up before you can chat with it." : undefined}
      aria-description={blocked ? "Not ready yet: its owner has to finish setting it up." : undefined}
      onClick={() => { if (!blocked) onBot(b.id); }}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${current ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"} ${blocked ? "cursor-not-allowed opacity-50" : ""}`}>
      <BotAvatar id={b.id} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="truncate font-medium">{b.name}</span>{b.kind === "chief" && <span className="sr-only"> (your chief)</span>}{b.visibility === "private" && b.kind !== "chief" && <span className="sr-only"> (private)</span>}</span>
        <span className="block truncate text-xs text-muted-foreground">{blocked ? "Not ready · owner is setting it up" : setup ? "Not ready yet · finish setup" : subtitle(b)}</span>
      </span>
      {setup && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-400" />}
    </button>
  );
}

export function ChatSidebar({ bots, spaces, chats, botId, chatId, onBot, onChat, onNewChat, onAddBot, onAddSpace }: Props) {
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const attention = useAttentionSummary();
  const q = query.trim().toLowerCase();
  const matches = (b: Bot) => !q || b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q);
  const visibleBots = bots.filter(matches);
  const chief = visibleBots.find((b) => b.kind === "chief");
  const rest = visibleBots.filter((b) => b !== chief);
  const visibleChats = chats.filter((c) => !q || c.title.toLowerCase().includes(q));
  const heading = "px-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-sidebar md:border-r" aria-label="Bots and chats">
      <div className="space-y-3 p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="px-1 text-lg font-semibold tracking-tight">Chats</h1>
          <Button size="icon-sm" variant="ghost" aria-label="Add a bot or workspace" aria-expanded={adding} onClick={() => setAdding((a) => !a)}><Plus /></Button>
        </div>
        <label className="relative block"><span className="sr-only">Search bots and chats</span><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className={`${field} h-10 pl-9`} /></label>
        {adding && (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <form onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; onAddBot(newName.trim()); setNewName(""); setAdding(false); }} className="flex gap-2">
              <input aria-label="New bot name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New specialist" className={field} /><Button type="submit" size="sm">Add</Button>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const name = String(f.get("space") ?? "").trim(); if (!name) return; onAddSpace(name, String(f.get("parent") ?? "") || undefined); e.currentTarget.reset(); }} className="flex gap-2">
              <input name="space" aria-label="New workspace" placeholder="New workspace" className={field} />
              {spaces.length > 0 && <select name="parent" aria-label="Inside workspace" className={`${field} w-24`}><option value="">top</option>{spaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
              <Button type="submit" size="sm" variant="outline">Group</Button>
            </form>
          </div>)}
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-3">
        <nav aria-label="Bots" className="space-y-1"><h2 className={heading}>Bots</h2>
          {chief && <ul className="space-y-0.5"><li><BotRow b={chief} current={chief.id === botId} onBot={onBot} /></li></ul>}
          {[...spaces.map((w) => ({ id: w.id as string | null, name: w.name })), { id: null, name: spaces.length ? "Ungrouped" : "" }].map((group) => {
            const members = rest.filter((b) => (b.workspaceId ?? null) === group.id);
            if (!members.length) return null;
            return (
              <div key={group.id ?? "none"} role="group" aria-label={group.name || "Bots"}>
                {group.name && <h3 className="mt-2 mb-1 text-xs text-muted-foreground" style={{ paddingLeft: `${0.625 + depthOf(spaces, group.id) * 0.75}rem` }}>{group.name}</h3>}
                <ul className="space-y-0.5">{members.map((b) => <li key={b.id}><BotRow b={b} current={b.id === botId} onBot={onBot} /></li>)}</ul>
              </div>);
          })}
          {q && visibleBots.length === 0 && <p className="px-2.5 text-xs text-muted-foreground">No bots match.</p>}
        </nav>
        <nav aria-label="Chats" className="space-y-1">
          <div className="flex items-center justify-between pr-1"><h2 className={heading}>Conversations</h2><Button size="xs" variant="ghost" onClick={onNewChat}>New chat</Button></div>
          <ul className="space-y-0.5">{visibleChats.map((c) => (
            <li key={c.id}><button type="button" aria-current={c.id === chatId} onClick={() => onChat(c.id)} className={`w-full truncate rounded-md px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${c.id === chatId ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}>{c.title}</button></li>))}</ul>
          {q && visibleChats.length === 0 && <p className="px-2.5 text-xs text-muted-foreground">No chats match.</p>}
        </nav>
      </div>
      <div className="border-t p-2">
        <Link to="/studio" className="flex items-center justify-between rounded-md px-2.5 py-2 transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
          <span>Needs your attention</span>
          <span className={`rounded-full px-2 text-xs ${attention && attention.unread > 0 ? "bg-destructive font-medium text-white" : "bg-muted text-muted-foreground"}`} aria-label={attention ? `${attention.unread} unread, ${attention.open} open` : "Attention items"}>{attention ? attention.unread : "…"}</span>
        </Link>
      </div>
    </aside>
  );
}

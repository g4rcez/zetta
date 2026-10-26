import { Link } from "@tanstack/react-router";
import { Bell, Bot as BotIcon, ChevronDown, FolderPlus, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Star } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@zetta/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@zetta/ui/components/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@zetta/ui/components/dropdown-menu";
import { cn } from "@zetta/ui/lib/utils";
import { Input, Select } from "@/components/ui";
import { BotAvatar, avatarColor, layoutOf, shade } from "@/components/bot-avatar";
import { useAttentionSummary } from "../attention/summary";

import type { Bot, Conversation, Workspace } from "./chat-client";

function depthOf(spaces: Workspace[], id: string | null) {
  let d = 0, cur = spaces.find((w) => w.id === id);
  while (cur?.parentId && d < 5) { d++; cur = spaces.find((w) => w.id === cur!.parentId); }
  return d;
}

type Props = {
  bots: Bot[]; spaces: Workspace[]; chats: Conversation[]; botId?: string | undefined; chatId?: string | undefined;
  onBot: (id: string) => void; onChat: (id: string) => void; onNewChat: (botId: string) => void;
  onNewBot: () => void; onAddSpace: (name: string, parentId?: string) => void;
  onUpdateChat: (id: string, patch: { title?: string; pinned?: boolean; favorite?: boolean }) => void;
};

// Every layout shares one avatar size so the bot list lines up.
const AVATAR_SIZE = 40;

const subtitle = (b: Bot) => b.description || (b.kind === "chief" ? "Your chief of staff" : b.harness === "fixture" ? "Offline test bot" : `${b.harness}${b.model ? ` · ${b.model}` : ""}`);

/** Rule: owners see their own unready bots with a setup hint and can still open them to finish setup; nobody else can chat with an unready team bot. */
function BotRow({ b, current, onBot }: { b: Bot; current: boolean; onBot: (id: string) => void }) {
  const blocked = !b.canEdit && !b.onboarded;
  const setup = b.canEdit && !b.onboarded;
  const layout = layoutOf(b.avatar) ?? "default";
  const c = avatarColor(b.avatar);
  const status = blocked ? "Not ready · owner is setting it up" : setup ? "Not ready yet · finish setup" : subtitle(b);
  const base = `flex w-full text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${blocked ? "cursor-not-allowed opacity-50" : ""}`;
  const idle = current ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60";
  const tag = (extra = "") => (b.kind === "chief" ? <span className="sr-only"> (your chief)</span> : b.visibility === "private" ? <span className={`sr-only ${extra}`}> (private)</span> : null);
  const name = <span className="flex items-center gap-2"><span className="truncate font-medium">{b.name}</span>{tag()}</span>;
  const sub = <span className="block truncate text-xs text-muted-foreground">{status}</span>;
  const dot = setup && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-400" />;
  const stack = <span className="min-w-0 flex-1">{name}{sub}</span>;
  // Each preset shape gets its own row layout, tinted with the color the owner picked.
  const variants: Record<string, { cls: string; style?: CSSProperties; square?: boolean; body: ReactNode }> = {
    default: { cls: `items-center gap-3 rounded-lg px-2.5 py-2 ${idle}`, body: stack },
    // Arrow: mail-client row with the harness on the right.
    mail: { cls: `items-center gap-3 rounded-lg px-2.5 py-2 ${idle}`, body: <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2">{name}<span className="shrink-0 text-[11px] text-muted-foreground">{b.harness}</span></span>{sub}</span> },
    compact: { cls: `items-center gap-2 rounded-md px-2 py-1 ${idle}`, body: <span className="flex min-w-0 flex-1 items-baseline gap-2">{name}<span className="truncate text-xs text-muted-foreground">{status}</span></span> },
    bubble: { cls: `flex-row-reverse items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-right ${idle}`, style: { backgroundColor: current || !c ? undefined : `${c}26` },
      body: <span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.name}{tag()}</span>{sub}</span> },
    card: { cls: `items-center gap-3 rounded-xl border px-2.5 py-2 ${idle}`, style: { borderColor: c && `${c}88`, backgroundColor: current || !c ? undefined : `${c}22` }, square: true, body: stack },
    terminal: { cls: `items-center gap-2.5 rounded-r-md border-l-4 px-2.5 py-1.5 font-mono ${idle}`, style: { borderLeftColor: c },
      body: <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{"> "}{b.name}{tag()}</span><span className="block truncate text-[11px] text-muted-foreground">{status}</span></span> },
    poster: { cls: `items-center gap-3 rounded-lg px-2.5 py-3 ${idle}`, style: { boxShadow: `inset 0 -3px 0 ${c ?? "transparent"}` },
      body: <span className="min-w-0 flex-1"><span className="block truncate text-base font-semibold leading-tight">{b.name}{tag()}</span><span className="line-clamp-2 text-xs text-muted-foreground">{status}</span><span className="mt-1 inline-block rounded bg-muted px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{b.harness}</span></span> },
    banner: { cls: `items-center gap-3 rounded-lg px-2.5 py-2 text-white ${blocked ? "" : "hover:brightness-110"}`, style: { backgroundImage: `linear-gradient(110deg, ${shade(c ?? "#4338ca", -0.45)}, ${c ?? "#4338ca"})`, outline: current ? `2px solid ${shade(c ?? "#fff", 0.5)}` : undefined },
      body: <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{b.name}{tag()}</span><span className="block truncate text-xs text-white/75">{status}</span></span> },
    // Hexagon: centered tile with the avatar on top.
    tile: { cls: `flex-col items-center gap-1 rounded-xl px-2.5 py-3 text-center ${idle}`, style: { backgroundColor: current || !c ? undefined : `${c}14` },
      body: <span className="w-full min-w-0"><span className="block truncate font-medium">{b.name}{tag()}</span>{sub}</span> },
    // Diamond: dashed outline, name only until hovered.
    outline: { cls: `items-center gap-3 rounded-lg border border-dashed px-2.5 py-2 ${idle}`, style: { borderColor: c },
      body: <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold uppercase tracking-widest">{b.name}{tag()}</span><span className="block truncate text-[11px] text-muted-foreground">{status}</span></span> },
    // Star: glowing avatar; the tinted halo only marks the open bot so an idle row never reads as selected.
    spotlight: { cls: `items-center gap-3 rounded-2xl px-3 py-2.5 ${idle}`, style: { boxShadow: c && current ? `0 0 0 1px ${c}55, 0 4px 18px -6px ${c}99` : undefined },
      body: <span className="min-w-0 flex-1"><span className="block truncate font-bold">{b.name}{tag()}</span><span className="line-clamp-2 text-xs text-muted-foreground">{status}</span></span> },
    // Orbit: avatar inside a colored ring, single tight line.
    ring: { cls: `items-center gap-3 rounded-full py-1 pr-3 pl-1 ${idle}`, body: <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{b.name}{tag()}</span><span className="block truncate text-[11px] text-muted-foreground">{status}</span></span>, style: { boxShadow: c ? `inset 0 0 0 2px ${c}` : undefined } },
    // Mouse: soft rounded cushion with an italic serif name.
    cozy: { cls: `items-center gap-3 rounded-3xl px-3.5 py-2.5 ${idle}`, style: { backgroundColor: current || !c ? undefined : `${c}1f` }, body: <span className="min-w-0 flex-1"><span className="block truncate font-serif text-base italic">{b.name}{tag()}</span>{sub}</span> },
    // Robot: boxed console readout with a status tag.
    console: { cls: `items-center gap-2.5 rounded-sm border px-2.5 py-1.5 font-mono ${idle}`, style: { borderColor: c }, square: true,
      body: <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-[12px] font-medium uppercase"><span className="truncate">{b.name}{tag()}</span><span className="shrink-0 text-[10px]" style={{ color: c }}>{b.onboarded ? "● ready" : "○ setup"}</span></span><span className="block truncate text-[11px] text-muted-foreground">{status}</span></span> },
    // Cat: tilted sticker with a hard offset shadow.
    sticker: { cls: `items-center gap-3 rounded-lg border-2 px-2.5 py-2 -rotate-1 ${idle}`, style: { borderColor: c, boxShadow: c ? `3px 3px 0 ${c}` : undefined }, body: <span className="min-w-0 flex-1"><span className="block truncate font-extrabold">{b.name}{tag()}</span>{sub}</span> },
    // Owl: large avatar with a vertical accent ribbon on the right.
    ribbon: { cls: `items-center gap-3 rounded-md border-r-8 px-2.5 py-2.5 ${idle}`, style: { borderRightColor: c }, square: true, body: <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold uppercase tracking-wide">{b.name}{tag()}</span><span className="line-clamp-2 text-xs text-muted-foreground">{status}</span></span> },
    // Spark: frosted glass fading out to the right, with a glow behind the avatar.
    glass: { cls: `items-center gap-3 rounded-xl px-2.5 py-2 ${idle}`, style: { backgroundImage: c && !current ? `linear-gradient(90deg, ${c}33, transparent)` : undefined, boxShadow: c ? `inset 1px 1px 0 ${c}44` : undefined },
      body: <span className="min-w-0 flex-1"><span className="block truncate font-semibold" style={{ color: c }}>{b.name}{tag()}</span>{sub}</span> },
  };
  const v = variants[layout] ?? variants.default!;
  return (
    <button type="button" aria-current={current} aria-disabled={blocked || undefined} title={blocked ? "Its owner has to finish setting this bot up before you can chat with it." : undefined}
      aria-description={blocked ? "Not ready yet: its owner has to finish setting it up." : undefined}
      onClick={() => { if (!blocked) onBot(b.id); }} className={`${base} ${v.cls}`} style={v.style}>
      <BotAvatar bot={b} size={AVATAR_SIZE} square={v.square} />
      {v.body}
      {dot}
    </button>
  );
}

/** A conversation row: click opens it; the hover menu renames (inline), pins (floats to the top of its group) and favorites (lists it under Favorites). */
function ChatRow({ c, current, onOpen, onUpdate }: { c: Conversation; current: boolean; onOpen: (id: string) => void; onUpdate: Props["onUpdateChat"] }) {
  const [editing, setEditing] = useState(false);
  const commit = (value: string) => { setEditing(false); const title = value.trim(); if (title && title !== c.title) onUpdate(c.id, { title }); };
  if (editing) {
    return (
      <li className="py-0.5 pr-1 pl-7">
        <input autoFocus aria-label="Rename chat" defaultValue={c.title} maxLength={120} onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { e.currentTarget.value = c.title; e.currentTarget.blur(); } }}
          className="h-7 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </li>);
  }
  return (
    <li className="group/chat relative">
      <button type="button" aria-current={current} onClick={() => onOpen(c.id)} onDoubleClick={() => setEditing(true)}
        className={cn("flex w-full items-center gap-2 rounded-md py-1.5 pr-8 pl-7 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", current ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground")}>
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
        {c.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0 opacity-60" />}
        {c.favorite && <Star aria-label="Favorite" className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" aria-label={`Actions for ${c.title}`} className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/chat:opacity-100 data-popup-open:opacity-100" />}>
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onClick={() => setEditing(true)}><Pencil />Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onUpdate(c.id, { pinned: !c.pinned })}>{c.pinned ? <PinOff /> : <Pin />}{c.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onUpdate(c.id, { favorite: !c.favorite })}><Star />{c.favorite ? "Remove from favorites" : "Add to favorites"}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>);
}

/** Slack-style collapsible section header: chevron, title, optional hover action. */
function Section({ title, icon, children, action, indent = 0 }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode; indent?: number }) {
  return (
    <Collapsible defaultOpen className="group/section">
      <div className="flex items-center pr-1" style={{ paddingLeft: `${indent * 0.75}rem` }}>
        <CollapsibleTrigger className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-not-data-open/section:-rotate-90" />{icon}<span className="truncate">{title}</span>
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent><ul className="mt-1 space-y-0.5">{children}</ul></CollapsibleContent>
    </Collapsible>
  );
}

/** Bots (chief, then one collapsible section per workspace) and the current bot's conversations, under a Slack-style header. */
export function ChatSidebar({ bots, spaces, chats, botId, chatId, onBot, onChat, onNewChat, onNewBot, onAddSpace, onUpdateChat }: Props) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const attention = useAttentionSummary();
  const q = query.trim().toLowerCase();
  const matches = (b: Bot) => !q || b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q);
  const visibleBots = bots.filter(matches);
  const chief = visibleBots.find((b) => b.kind === "chief");
  const rest = visibleBots.filter((b) => b !== chief);
  // Pinned first; the server already orders by recency, and Array.sort is stable.
  const visibleChats = chats.filter((c) => !q || c.title.toLowerCase().includes(q)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const favorites = visibleChats.filter((c) => c.favorite);
  // Conversations grouped under their bot, in sidebar order; favorites live in their own section. The open bot always shows (to start its first chat).
  const chatGroups = [chief, ...rest].filter((b): b is Bot => !!b).map((bot) => ({ bot, all: visibleChats.filter((c) => c.botId === bot.id) })).map(({ bot, all }) => ({ bot, all: all.length, list: all.filter((c) => !c.favorite) })).filter(({ bot, all }) => all > 0 || (!q && bot.id === botId));
  const chatRow = (c: Conversation) => <ChatRow key={c.id} c={c} current={c.id === chatId} onOpen={onChat} onUpdate={onUpdateChat} />;
  const groups = [...spaces.map((w) => ({ id: w.id as string | null, name: w.name })), { id: null, name: "Ungrouped" }];
  const row = (b: Bot) => <li key={b.id}><BotRow b={b} current={b.id === botId} onBot={onBot} /></li>;
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-sidebar text-sidebar-foreground md:border-r md:border-sidebar-border" aria-label="Bots and chats">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-sidebar-border px-3">
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-left text-lg font-bold hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring" />}>
            <span className="truncate">Chats</span><ChevronDown aria-hidden="true" className="size-4 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => { setAdding(false); onNewBot(); }}><BotIcon />New bot</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAdding(true)}><FolderPlus />New workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon-sm" variant="ghost" title="New bot" aria-label="New bot" onClick={() => { setAdding(false); onNewBot(); }}><BotIcon /></Button>
        <Button size="icon-sm" variant="ghost" title="New workspace" aria-label="New workspace" aria-expanded={adding} onClick={() => setAdding((a) => !a)}><FolderPlus /></Button>
      </div>
      <div className="shrink-0 space-y-2 p-2">
        <Input title="Search bots and chats" hiddenLabel type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Jump to…" left={<Search aria-hidden="true" className="size-4 text-muted-foreground" />} />
        {adding && (
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const name = String(f.get("space") ?? "").trim(); if (!name) return; onAddSpace(name, String(f.get("parent") ?? "") || undefined); e.currentTarget.reset(); }} className="flex gap-2 rounded-lg border bg-card p-2">
            <Input title="New workspace" hiddenLabel name="space" placeholder="New workspace" autoFocus />
            {spaces.length > 0 && <Select title="Inside workspace" hiddenLabel container="w-24" required={false} name="parent" options={[{ value: "", label: "top" }, ...spaces.map((w) => ({ value: w.id, label: w.name }))]} />}
            <Button type="submit" size="sm" variant="outline">Create</Button>
          </form>)}
        <Link to="/studio/$tab" params={{ tab: "attention" }} className="flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
          <Bell aria-hidden="true" className="size-4 text-muted-foreground" /><span className="flex-1">Needs your attention</span>
          <span className={cn("rounded-full px-2 text-xs", attention && attention.unread > 0 ? "bg-destructive font-medium text-white" : "bg-muted text-muted-foreground")} aria-label={attention ? `${attention.unread} unread, ${attention.open} open` : "Attention items"}>{attention ? attention.unread : "…"}</span>
        </Link>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        <nav aria-label="Bots">
          <Section title="Bots">
            {chief && row(chief)}
            {groups.map((group) => {
              const members = rest.filter((b) => (b.workspaceId ?? null) === group.id);
              if (!members.length) return null;
              return (
                <li key={group.id ?? "none"} role="group" aria-label={group.name}>
                  {(spaces.length > 0) && <h3 className="mt-2 mb-1 text-xs text-muted-foreground" style={{ paddingLeft: `${0.625 + depthOf(spaces, group.id) * 0.75}rem` }}>{group.name}</h3>}
                  <ul className="space-y-0.5">{members.map(row)}</ul>
                </li>);
            })}
            {q && visibleBots.length === 0 && <li className="px-2.5 text-xs text-muted-foreground">No bots match.</li>}
          </Section>
        </nav>
        <nav aria-label="Conversations" className="space-y-2">
          {favorites.length > 0 && <Section title="Favorites" icon={<Star aria-hidden="true" className="size-3.5 fill-amber-400 text-amber-400" />}>{favorites.map(chatRow)}</Section>}
          {chatGroups.map(({ bot, all, list }) => (
            <Section key={bot.id} title={bot.name} icon={<BotAvatar bot={bot} size={16} />}
              action={<Button size="icon-xs" variant="ghost" aria-label={`New chat with ${bot.name}`} title="New chat" className={cn(bot.id !== botId && "opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100")} onClick={() => onNewChat(bot.id)}><Plus /></Button>}>
              {list.map(chatRow)}
              {all === 0 && <li className="py-1 pl-7 text-xs text-muted-foreground">No conversations yet.</li>}
            </Section>))}
          {q && chatGroups.length === 0 && <p className="px-2.5 text-xs text-muted-foreground">No chats match.</p>}
        </nav>
      </div>
    </aside>
  );
}

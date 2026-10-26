import { useState } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { chatClient, errorMessage, REACTION_EMOJIS, type Bot, type Message, type UsedKnowledge } from "./chat-client";
import { Markdown } from "./markdown";

function UsedNotes({ message }: { message: Message }) {
  const [data, setData] = useState<UsedKnowledge>();
  const [error, setError] = useState<string>();
  const used = message.meta?.used, n = (used?.memories?.length ?? 0) + (used?.instructions?.length ?? 0);
  if (n === 0) return null;
  return (
    <details className="mt-2 text-xs text-muted-foreground" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !data) chatClient.usedKnowledge(message.id).then(setData, (x) => setError(errorMessage(x))); }}>
      <summary className="cursor-pointer select-none">Used {n} {n === 1 ? "note" : "notes"}</summary>
      <div aria-live="polite" className="mt-1 space-y-1">
        {!data && !error && <p>Loading…</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {data?.memories.length ? <div><p className="font-medium">Remembered about you</p><ul className="list-disc pl-4">{data.memories.map((m) => <li key={m.id} className="break-words">{m.content}</li>)}</ul></div> : null}
        {data?.instructions.length ? <div><p className="font-medium">Instructions</p><ul className="list-disc pl-4">{data.instructions.map((m) => <li key={m.id} className="break-words">{m.title}</li>)}</ul></div> : null}
        {data && !data.memories.length && !data.instructions.length && <p>Those notes no longer exist.</p>}
      </div>
    </details>
  );
}

const reveal = "transition-opacity [@media(hover:none)]:opacity-100";
export function MessageItem({ message: m, bots, botId, onReply, onToggleReaction, onSaveInstruction }: { message: Message; bots: Bot[]; botId?: string; onReply: (m: Message) => void; onToggleReaction: (m: Message, emoji: string) => void; onSaveInstruction: (m: Message) => void }) {
  const mine = m.role === "user";
  const receipts = (m.meta?.receipts ?? []).filter((r) => r.kind !== "proposal");
  const other = m.role === "assistant" && m.botId && m.botId !== botId ? bots.find((b) => b.id === m.botId) : undefined;
  return (
    <div className={`group flex min-w-0 gap-3 ${mine ? "justify-end" : ""}`}>
      {other && <BotAvatar id={other.id} size={32} className="mt-1" />}
      <div className={`min-w-0 max-w-[min(42rem,85%)] ${mine ? "items-end" : ""}`}>
        {other && <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">{other.name} answers</p>}
        <div className={`break-words rounded-xl px-4 py-2.5 text-[15px] leading-relaxed ${mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-card ring-1 ring-border"}`}>
          {m.parentMessageId && <p className="mb-1 text-xs opacity-70">↳ in thread</p>}
          {m.attachments?.map((a) => <p key={a.id} className="mb-1 text-xs opacity-80">📎 {a.name}</p>)}
          <Markdown source={m.content} />
          {m.status === "failed" && <span role="alert" className="ml-1 text-xs opacity-80">(failed)</span>}{m.status === "interrupted" && <span role="alert" className="ml-1 text-xs opacity-80">(interrupted: the server restarted while answering)</span>}{m.status === "cancelled" && <span className="ml-1 text-xs opacity-80">(stopped)</span>}
          {receipts.length > 0 && <ul className="mt-2 flex flex-wrap gap-1 text-xs" aria-label="What the bot saved">{receipts.map((r) => <li key={`${r.kind}-${r.id}`} className="rounded-full bg-muted px-2 py-0.5 text-foreground" title={r.text}>{r.kind === "memory" ? "💾 remembered" : "📘 saved instruction"}{r.created === false ? " (already saved)" : ""}</li>)}</ul>}
          {m.role === "assistant" && <UsedNotes message={m} />}
        </div>
        <div className={`mt-1 flex flex-wrap items-center gap-1 px-1 text-xs ${mine ? "justify-end" : ""}`}>
          <div role="group" aria-label="Reactions" className="flex flex-wrap items-center gap-1">
            {REACTION_EMOJIS.map((emoji) => {
              const r = m.reactions?.find((x) => x.emoji === emoji);
              return <button key={emoji} type="button" aria-pressed={r?.mine ?? false} aria-label={`${emoji} ${r?.count ?? 0}`} onClick={() => onToggleReaction(m, emoji)}
                className={`rounded-full border px-1.5 py-0.5 focus-visible:outline-2 focus-visible:outline-ring ${r?.mine ? "border-primary bg-primary/15 font-medium" : r ? "bg-card" : `border-transparent opacity-0 group-hover:opacity-70 group-focus-within:opacity-70 hover:!opacity-100 ${reveal}`}`}>{emoji}{r ? ` ${r.count}` : ""}</button>;
            })}
          </div>
          <span className={`flex gap-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${reveal}`}>
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => onReply(m)}>Reply in thread</button>
            {m.role === "assistant" && <button type="button" className="hover:text-foreground hover:underline" onClick={() => onSaveInstruction(m)}>Save as instruction</button>}
          </span>
        </div>
      </div>
    </div>
  );
}

import { CheckCheck, Image as ImageIcon, MessageCircle } from "lucide-react";

import { cn } from "@zetta/ui/lib/utils";

type ChatsView = { kind: "chats"; chats: { id: string; name: string; last: string; fromMe: boolean }[] };
type MessagesView = { kind: "messages"; chat: string; messages: { at: number; from: string; text: string; media: boolean }[] };
export type WhatsappData = ChatsView | MessagesView;

/** Validates the server-built block; anything else is shown as plain code by the caller. */
export function parseWhatsapp(raw: string): WhatsappData | undefined {
  try {
    const d = JSON.parse(raw) as WhatsappData;
    if (d?.kind === "chats" && Array.isArray(d.chats)) return d;
    if (d?.kind === "messages" && Array.isArray(d.messages)) return d;
  } catch { /* partial or malformed */ }
  return undefined;
}

const initials = (n: string) => (n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
const time = (s: number) => (s ? new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const day = (s: number) => new Date(s * 1000).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
const who = (id: string) => id.replace(/@.*$/, "");

/** WhatsApp-style rendering of what the bot read: a chat list or a conversation with bubbles. Display only. */
export function WhatsappView({ data }: { data: WhatsappData }) {
  return (
    <figure aria-label="WhatsApp" className="w-full max-w-md overflow-hidden rounded-xl border bg-card text-sm shadow-sm">
      <figcaption className="flex items-center gap-2 bg-[#008069] px-3 py-2 font-medium text-white"><MessageCircle aria-hidden className="size-4" />{data.kind === "chats" ? "WhatsApp" : who(data.chat)}</figcaption>
      {data.kind === "chats" ? (
        data.chats.length === 0 ? <p className="p-3 text-muted-foreground">No chats.</p> : (
          <ul className="divide-y">{data.chats.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#25d366]/20 font-semibold text-[#008069] dark:text-[#25d366]">{initials(c.name || who(c.id))}</span>
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.name || who(c.id)}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">{c.fromMe && <CheckCheck aria-label="You sent" className="size-3.5 shrink-0 text-sky-500" />}<span className="truncate">{c.last || "No messages"}</span></p></div>
            </li>))}</ul>)
      ) : (
        <ol className="flex max-h-96 flex-col gap-1 overflow-y-auto bg-[#efeae2] p-3 dark:bg-[#0b141a]">
          {data.messages.length === 0 && <li className="text-center text-xs text-muted-foreground">No messages.</li>}
          {data.messages.map((m, i) => {
            const mine = m.from === "me", prev = data.messages[i - 1], newDay = m.at && (!prev || day(prev.at) !== day(m.at));
            return (
              <li key={i} className="contents">
                {newDay && <span className="mx-auto my-1 rounded-md bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">{day(m.at)}</span>}
                <div className={cn("max-w-[80%] rounded-lg px-2.5 py-1.5 shadow-sm", mine ? "self-end bg-[#d9fdd3] text-black dark:bg-[#005c4b] dark:text-white" : "self-start bg-white text-black dark:bg-[#202c33] dark:text-white")}>
                  {m.media && <p className="flex items-center gap-1 text-xs opacity-70"><ImageIcon aria-hidden className="size-3.5" />Media</p>}
                  {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-60">{time(m.at)}{mine && <CheckCheck aria-hidden className="size-3 text-sky-500" />}</p>
                </div>
              </li>);
          })}
        </ol>)}
    </figure>
  );
}

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, AtSign, Bold, Code, Eye, FolderOpen, Italic, Link2, Paperclip, Square, X } from "lucide-react";

import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentGroup, AttachmentMedia, AttachmentTitle } from "@zetta/ui/components/attachment";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@zetta/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@zetta/ui/components/popover";
import { Separator } from "@zetta/ui/components/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@zetta/ui/components/tooltip";
import { cn } from "@zetta/ui/lib/utils";
import { BotAvatar } from "@/components/bot-avatar";

import { listFiles, uploadAttachment, type Attachment as Attached, type Bot } from "./chat-client";
import { Response } from "./response";

export type Outgoing = { text: string; attachmentIds: string[]; fileRefs: string[] };
const mentionKey = (name: string) => name.replace(/\s+/g, "");

function Tool({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger render={<InputGroupButton size="icon-xs" aria-label={label} aria-pressed={pressed} className={cn(pressed && "bg-muted text-foreground")} onClick={onClick} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

/** Slack-style message box: formatting row, attachments, @mentions, Enter to send, Shift+Enter for a new line. */
export function Composer({ value, onChange, placeholder, bots, busy, disabled, conversationId, onSubmit, onStop, onError, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder: string; bots: Bot[]; busy: boolean; disabled?: boolean; conversationId?: string | undefined;
  onSubmit: (out: Outgoing) => Promise<boolean> | boolean; onStop?: () => void; onError: (e: unknown) => void; autoFocus?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [picker, setPicker] = useState<{ path: string; entries: { name: string; kind: "file" | "dir" }[] }>();
  const [previewing, setPreviewing] = useState(false);
  const [mention, setMention] = useState<{ query: string; at: number; index: number }>();
  const candidates = mention ? bots.filter((b) => b.onboarded && mentionKey(b.name).toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6) : [];
  const canSend = !!value.trim() && !busy && !disabled;

  function wrap(before: string, after = before) {
    const el = input.current; if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el, picked = value.slice(s, e) || "text";
    onChange(value.slice(0, s) + before + picked + after + value.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + picked.length); });
  }
  function trackMention(text: string, caret: number) {
    const m = /(^|\s)@([\p{L}\p{N}_-]{0,40})$/u.exec(text.slice(0, caret));
    setMention(m ? { query: m[2]!, at: caret - m[2]!.length - 1, index: 0 } : undefined);
  }
  function pickMention(b: Bot) {
    if (!mention) return;
    const end = mention.at + 1 + mention.query.length, insert = `@${mentionKey(b.name)} `;
    onChange(value.slice(0, mention.at) + insert + value.slice(end)); setMention(undefined);
    requestAnimationFrame(() => { const el = input.current; el?.focus(); el?.setSelectionRange(mention.at + insert.length, mention.at + insert.length); });
  }
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    const ok = await onSubmit({ text: value.trim(), attachmentIds: attached.map((a) => a.id), fileRefs });
    if (ok) { setAttached([]); setFileRefs([]); setPreviewing(false); }
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && candidates.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const d = e.key === "ArrowDown" ? 1 : -1; setMention({ ...mention, index: (mention.index + d + candidates.length) % candidates.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(candidates[mention.index]!); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(undefined); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
    else if (e.key === "Escape") { if (picker) setPicker(undefined); else if (previewing) setPreviewing(false); else e.currentTarget.blur(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") { e.preventDefault(); wrap("**"); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") { e.preventDefault(); wrap("_"); }
  }
  const openFiles = (path: string) => void listFiles(path).then((entries) => setPicker({ path, entries }), onError);

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Send a message" className="relative">
      {mention && candidates.length > 0 && (
        <ul role="listbox" aria-label="Mention a bot" className="absolute bottom-full left-0 z-20 mb-1 w-72 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
          <li className="px-2 py-1 text-xs font-medium text-muted-foreground" role="presentation">Bots</li>
          {candidates.map((b, i) => (
            <li key={b.id} role="option" aria-selected={i === mention.index} onMouseDown={(e) => { e.preventDefault(); pickMention(b); }}
              className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm", i === mention.index ? "bg-accent text-accent-foreground" : "hover:bg-muted")}>
              <BotAvatar bot={b} size={20} square /><span className="font-medium">{b.name}</span><span className="truncate text-xs text-muted-foreground">@{mentionKey(b.name)}</span>
            </li>))}
        </ul>)}
      <InputGroup className="h-auto rounded-lg bg-card shadow-xs">
        <InputGroupAddon align="block-start" className="gap-0.5 border-b px-1.5 py-1">
          <Tool label="Bold (⌘B)" onClick={() => wrap("**")}><Bold /></Tool>
          <Tool label="Italic (⌘I)" onClick={() => wrap("_")}><Italic /></Tool>
          <Tool label="Code" onClick={() => wrap("`")}><Code /></Tool>
          <Tool label="Link" onClick={() => wrap("[", "](https://)")}><Link2 /></Tool>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Tool label={previewing ? "Hide preview" : "Preview"} pressed={previewing} onClick={() => setPreviewing((p) => !p)}><Eye /></Tool>
        </InputGroupAddon>
        {(attached.length > 0 || fileRefs.length > 0) && (
          <InputGroupAddon align="block-start" className="pb-0">
            <AttachmentGroup aria-label="Attachments" className="flex-wrap">
              {attached.map((a) => <Attachment key={a.id} size="sm"><AttachmentMedia><Paperclip /></AttachmentMedia><AttachmentContent><AttachmentTitle className="max-w-40 truncate">{a.name}</AttachmentTitle></AttachmentContent><AttachmentActions><AttachmentAction aria-label={`Remove ${a.name}`} onClick={() => setAttached((l) => l.filter((x) => x.id !== a.id))}><X /></AttachmentAction></AttachmentActions></Attachment>)}
              {fileRefs.map((f) => <Attachment key={f} size="sm"><AttachmentMedia><FolderOpen /></AttachmentMedia><AttachmentContent><AttachmentTitle className="max-w-40 truncate">{f}</AttachmentTitle></AttachmentContent><AttachmentActions><AttachmentAction aria-label={`Remove ${f}`} onClick={() => setFileRefs((l) => l.filter((x) => x !== f))}><X /></AttachmentAction></AttachmentActions></Attachment>)}
            </AttachmentGroup>
          </InputGroupAddon>)}
        {previewing
          ? <div aria-label="Message preview" className="max-h-60 w-full overflow-y-auto px-3 py-2">{value.trim() ? <Response text={value} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}</div>
          : <InputGroupTextarea ref={input} aria-label="Message" enterKeyHint="send" autoFocus={autoFocus} value={value} placeholder={placeholder} rows={1} disabled={disabled}
            className="field-sizing-content max-h-[40dvh] min-h-10 px-3 py-2 text-[15px]"
            onChange={(e) => { onChange(e.target.value); trackMention(e.target.value, e.target.selectionStart); }}
            onSelect={(e) => trackMention(e.currentTarget.value, e.currentTarget.selectionStart)} onBlur={() => setMention(undefined)} onKeyDown={onKeyDown} />}
        <InputGroupAddon align="block-end" className="gap-0.5 px-1.5 pb-1.5">
          <Tool label="Attach text file" onClick={() => file.current?.click()}><Paperclip /></Tool>
          <input ref={file} type="file" hidden accept=".txt,.md,.json,.csv,.log,.ts,.js,.py,text/*" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { const att = await uploadAttachment(f.name, await f.text(), conversationId); setAttached((a) => [...a, att]); } catch (x) { onError(x); } }} />
          <Popover open={!!picker} onOpenChange={(open) => { if (!open) setPicker(undefined); }}>
            <Tooltip><TooltipTrigger render={<PopoverTrigger render={<InputGroupButton size="icon-xs" aria-label="Server files" onClick={() => openFiles("shared")} />} />}><FolderOpen /></TooltipTrigger><TooltipContent>Server files</TooltipContent></Tooltip>
            <PopoverContent align="start" className="w-72 p-2 text-sm">
              <p className="truncate px-1 pb-1 text-xs font-medium text-muted-foreground">{picker?.path}</p>
              <ul className="max-h-60 overflow-y-auto">{picker?.entries.map((en) => <li key={en.name}><button type="button" className="w-full truncate rounded px-1.5 py-1 text-left hover:bg-muted" onClick={() => { const p = `${picker.path}/${en.name}`; if (en.kind === "dir") openFiles(p); else { setFileRefs((r) => [...r, p]); setPicker(undefined); } }}>{en.kind === "dir" ? "📂" : "📄"} {en.name}</button></li>)}
                {picker?.entries.length === 0 && <li className="px-1.5 py-1 text-muted-foreground">Empty. Put files under the server's files folder.</li>}</ul>
            </PopoverContent>
          </Popover>
          <Tool label="Mention a bot" onClick={() => { onChange(`${value}${value && !value.endsWith(" ") ? " " : ""}@`); requestAnimationFrame(() => { const el = input.current; if (!el) return; el.focus(); const end = el.value.length; el.setSelectionRange(end, end); trackMention(el.value, end); }); }}><AtSign /></Tool>
          <span className="flex-1" /><span className="hidden pr-2 text-[11px] text-muted-foreground sm:inline"><kbd className="font-sans font-medium">Shift + Return</kbd> for a new line</span>
          {busy && onStop
            ? <InputGroupButton size="icon-sm" variant="outline" aria-label="Stop" onClick={onStop}><Square className="fill-current" /></InputGroupButton>
            : <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label="Send" disabled={!canSend} className="data-disabled:bg-muted data-disabled:text-muted-foreground"><ArrowUp /></InputGroupButton>}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

import { Alert } from "@g4rcez/components/alert";
import { looksSecret } from "@zetta/core/secrets";
import { uuidv7 } from "@zetta/core/uuid";
import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUpIcon,
  AtIcon,
  TextBIcon,
  BookOpenIcon,
  CodeIcon,
  EyeIcon,
  FolderOpenIcon,
  TextItalicIcon,
  LinkIcon,
  CircleNotchIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from "@phosphor-icons/react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@zetta/ui/components/attachment";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@zetta/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@zetta/ui/components/popover";
import { Separator } from "@zetta/ui/components/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@zetta/ui/components/tooltip";
import { cn } from "@zetta/ui/lib/utils";

import { ImageViewer } from "./attachment-image";
import { instructionSummary } from "./triggers";
import {
  IMAGE_MAX_BYTES,
  listFiles,
  uploadAttachment,
  uploadImage,
  type Attachment as Attached,
  type Bot,
  call,
} from "./chat-client";
import { matchTrigger } from "./triggers";
import { useMention } from "./mention";
import { Response } from "./response";

export type Outgoing = {
  text: string;
  attachmentIds: string[];
  fileRefs: string[];
  instructionIds?: string[];
};
type Instruction = { id: string; title: string; body: string; trigger?: string };
const PICTURES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_ATTACHMENTS = 5;
const MAX_INSTRUCTIONS = 5;
/** A picture the person picked: shown at once from the local file, kept until the message is sent. */
type Staged = { key: string; name: string; preview: string; id?: string; uploading: boolean };

function Tool({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            size="icon-xs"
            aria-label={label}
            aria-pressed={pressed}
            className={cn(pressed && "bg-muted text-foreground")}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Slack-style message box: formatting row, attachments, @mentions, Enter to send, Shift+Enter for a new line. */
export function Composer({
  value,
  onChange,
  placeholder,
  bots,
  busy,
  disabled,
  conversationId,
  onSubmit,
  onStop,
  onError,
  autoFocus,
  minimal,
  instructions,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  bots: Bot[];
  busy: boolean;
  disabled?: boolean;
  conversationId?: string | undefined;
  onSubmit: (out: Outgoing) => Promise<boolean> | boolean;
  onStop?: () => void;
  onError: (e: unknown) => void;
  autoFocus?: boolean;
  /** Turn on the `/` picker: only for screens whose submit forwards `instructionIds`. */
  instructions?: boolean;
  /** Text only: no attachments, server files or @mentions (the setup interview). */ minimal?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [viewing, setViewing] = useState<number>();
  const [dragging, setDragging] = useState(false);
  // The text the person was warned about. Sending the same text again goes through, so the warning never blocks, it only asks once.
  const [flagged, setFlagged] = useState<string>();
  const secretWarning = flagged !== undefined && flagged === value.trim();
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [picker, setPicker] = useState<{
    path: string;
    entries: { name: string; kind: "file" | "dir" }[];
  }>();
  const [previewing, setPreviewing] = useState(false);
  const mention = useMention({ value, onChange, bots, inputRef: input });
  const [slash, setSlash] = useState<{ query: string; at: number; index: number }>();
  const [library, setLibrary] = useState<Instruction[]>();
  const [chosen, setChosen] = useState<Instruction[]>([]);
  const instructionCandidates =
    slash && library
      ? library
          .filter(
            (i) =>
              !chosen.some((c) => c.id === i.id) &&
              i.title.toLowerCase().includes(slash.query.toLowerCase()),
          )
          .slice(0, 6)
      : [];
  const pictures = staged.filter((x) => x.id);
  const total = attached.length + staged.length;
  const canSend =
    (!!value.trim() || attached.length > 0 || pictures.length > 0) &&
    !staged.some((x) => x.uploading) &&
    !disabled;

  function dropStaged(key: string) {
    setStaged((l) =>
      l.filter((x) => {
        if (x.key === key) {
          URL.revokeObjectURL(x.preview);
          previews.current.delete(x.preview);
        }
        return x.key !== key;
      }),
    );
  }
  async function addFiles(files: File[]) {
    let room = MAX_ATTACHMENTS - total - fileRefs.length;
    for (const f of files) {
      if (room <= 0) {
        onError(new Error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`));
        return;
      }
      if (f.type.startsWith("image/")) {
        if (!PICTURES.includes(f.type)) {
          onError(new Error("Images must be PNG, JPEG, WebP or GIF."));
          continue;
        }
        if (f.size > IMAGE_MAX_BYTES) {
          onError(new Error("Images can be up to 10 MB."));
          continue;
        }
        room--;
        const key = uuidv7(),
          preview = URL.createObjectURL(f);
        previews.current.add(preview);
        setStaged((l) => [...l, { key, name: f.name || "image", preview, uploading: true }]);
        try {
          const att = await uploadImage(f, conversationId);
          setStaged((l) =>
            l.map((x) => (x.key === key ? { ...x, id: att.id, uploading: false } : x)),
          );
        } catch (x) {
          dropStaged(key);
          onError(x);
        }
      } else {
        room--;
        try {
          const att = await uploadAttachment(f.name, await f.text(), conversationId);
          setAttached((a) => [...a, att]);
        } catch (x) {
          onError(x);
        }
      }
    }
  }
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pics = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return;
    if (!e.clipboardData.getData("text/plain")) e.preventDefault();
    void addFiles(pics);
  }

  function wrap(before: string, after = before) {
    const el = input.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el,
      picked = value.slice(s, e) || "text";
    onChange(value.slice(0, s) + before + picked + after + value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + picked.length);
    });
  }
  function trackMention(text: string, caret: number) {
    mention.track(text, caret);
    const s = instructions ? matchTrigger(text, caret, "/") : undefined;
    setSlash(s ? { ...s, index: 0 } : undefined);
    if (s && !library && chosen.length < MAX_INSTRUCTIONS)
      void call<{ instructions: Instruction[] }>("/api/instructions").then(
        (r) => setLibrary(r.instructions),
        onError,
      );
  }
  function openInstructions() {
    const el = input.current;
    if (!el) return;
    const at = el.selectionStart,
      pad = at > 0 && !/\s/.test(value[at - 1]!) ? " " : "",
      next = value.slice(0, at) + pad + "/" + value.slice(el.selectionEnd),
      caret = at + pad.length + 1;
    onChange(next);
    trackMention(next, caret);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }
  function pickInstruction(i: Instruction) {
    if (!slash) return;
    const end = slash.at + 1 + slash.query.length;
    onChange(value.slice(0, slash.at) + value.slice(end).replace(/^ /, ""));
    setChosen((l) => (l.length < MAX_INSTRUCTIONS ? [...l, i] : l));
    setSlash(undefined);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(slash.at, slash.at);
    });
  }
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    if (looksSecret(value) && flagged !== value.trim()) {
      setFlagged(value.trim());
      return;
    }
    const ok = await onSubmit({
      text: value.trim(),
      attachmentIds: [...attached.map((a) => a.id), ...pictures.map((x) => x.id!)],
      fileRefs,
      ...(chosen.length ? { instructionIds: chosen.map((i) => i.id) } : {}),
    });
    if (ok) {
      setChosen([]);
      setAttached([]);
      setFileRefs([]);
      setPreviewing(false);
      staged.forEach((x) => {
        URL.revokeObjectURL(x.preview);
        previews.current.delete(x.preview);
      });
      setStaged([]);
    }
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (slash && instructionCandidates.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSlash({
          ...slash,
          index: (slash.index + d + instructionCandidates.length) % instructionCandidates.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickInstruction(instructionCandidates[slash.index]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(undefined);
        return;
      }
    }
    if (mention.onKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      if (picker) setPicker(undefined);
      else if (previewing) setPreviewing(false);
      else e.currentTarget.blur();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrap("**");
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      wrap("_");
    }
  }
  const openFiles = (path: string) =>
    void listFiles(path).then((entries) => setPicker({ path, entries }), onError);

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Send a message"
      className="relative"
      onDragOver={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {secretWarning && (
        <Alert theme="warn" className="mb-2 text-xs">
          This looks like a key or password. The bot reads the chat and the chat is stored. To
          connect an account, ask the bot to set it up: it shows a private form that skips the chat.{" "}
          <button type="submit" className="underline">
            Send anyway
          </button>
        </Alert>
      )}
      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary"
        >
          Drop to attach
        </div>
      )}
      {viewing !== undefined && pictures[viewing] && (
        <ImageViewer
          pics={pictures.map((x) => ({ id: x.id!, name: x.name }))}
          start={viewing}
          onClose={() => setViewing(undefined)}
        />
      )}
      {slash && library && (
        <ul
          role="listbox"
          aria-label="Follow an instruction"
          className="absolute bottom-full left-0 z-20 mb-1 w-80 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
        >
          <li
            className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground"
            role="presentation"
          >
            Instructions
            <Link
              to="/studio/$tab"
              params={{ tab: "instructions" }}
              onMouseDown={(e) => e.preventDefault()}
              className="underline hover:text-foreground"
            >
              Manage
            </Link>
          </li>
          {instructionCandidates.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground" role="presentation">
              {library.length === 0 ? "No instructions yet. " : "No match."}
              {library.length === 0 && (
                <Link
                  to="/studio/$tab"
                  params={{ tab: "instructions" }}
                  onMouseDown={(e) => e.preventDefault()}
                  className="underline hover:text-foreground"
                >
                  Create one
                </Link>
              )}
            </li>
          )}
          {instructionCandidates.map((i, k) => (
            <li
              key={i.id}
              role="option"
              aria-selected={k === slash.index}
              title={instructionSummary(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pickInstruction(i);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                k === slash.index ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <BookOpenIcon className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{i.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {instructionSummary(i)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {mention.popup("above")}
      <InputGroup className="h-auto rounded-lg bg-card shadow-xs">
        <InputGroupAddon align="block-start" className="gap-0.5 border-b px-1.5 py-1">
          <Tool label="Bold (⌘B)" onClick={() => wrap("**")}>
            <TextBIcon />
          </Tool>
          <Tool label="Italic (⌘I)" onClick={() => wrap("_")}>
            <TextItalicIcon />
          </Tool>
          <Tool label="Code" onClick={() => wrap("`")}>
            <CodeIcon />
          </Tool>
          <Tool label="Link" onClick={() => wrap("[", "](https://)")}>
            <LinkIcon />
          </Tool>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Tool
            label={previewing ? "Hide preview" : "Preview"}
            pressed={previewing}
            onClick={() => setPreviewing((p) => !p)}
          >
            <EyeIcon />
          </Tool>
        </InputGroupAddon>
        {staged.length > 0 && (
          <InputGroupAddon align="block-start" className="pb-0">
            <ul aria-label="Images to send" className="flex flex-wrap gap-2">
              {staged.map((x) => (
                <li key={x.key} className="group/thumb relative">
                  <button
                    type="button"
                    disabled={x.uploading}
                    aria-label={`Preview ${x.name}`}
                    onClick={() => setViewing(pictures.findIndex((p) => p.key === x.key))}
                    className="block size-16 cursor-zoom-in overflow-hidden rounded-lg border bg-muted outline-offset-2 focus-visible:outline-2 disabled:cursor-progress"
                  >
                    <img
                      src={x.preview}
                      alt={x.name}
                      className={cn("size-full object-cover", x.uploading && "opacity-50")}
                    />
                  </button>
                  {x.uploading && (
                    <CircleNotchIcon
                      aria-label="Uploading"
                      className="pointer-events-none absolute inset-0 m-auto size-5 animate-spin text-foreground"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${x.name}`}
                    onClick={() => dropStaged(x.key)}
                    className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          </InputGroupAddon>
        )}
        {(attached.length > 0 || fileRefs.length > 0 || chosen.length > 0) && (
          <InputGroupAddon align="block-start" className="pb-0">
            <AttachmentGroup aria-label="Attachments" className="flex-wrap">
              {attached.map((a) => (
                <Attachment key={a.id} size="sm">
                  <AttachmentMedia>
                    <PaperclipIcon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle className="max-w-40 truncate">{a.name}</AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${a.name}`}
                      onClick={() => setAttached((l) => l.filter((x) => x.id !== a.id))}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
              {chosen.map((i) => (
                <Attachment key={i.id} size="sm" title={instructionSummary(i)}>
                  <AttachmentMedia>
                    <BookOpenIcon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle className="max-w-40 truncate">{i.title}</AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${i.title}`}
                      onClick={() => setChosen((l) => l.filter((x) => x.id !== i.id))}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
              {fileRefs.map((f) => (
                <Attachment key={f} size="sm">
                  <AttachmentMedia>
                    <FolderOpenIcon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle className="max-w-40 truncate">{f}</AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${f}`}
                      onClick={() => setFileRefs((l) => l.filter((x) => x !== f))}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        )}
        {previewing ? (
          <div aria-label="Message preview" className="max-h-60 w-full overflow-y-auto px-3 py-2">
            {value.trim() ? (
              <Response text={value} />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <InputGroupTextarea
            ref={input}
            aria-label="Message"
            enterKeyHint="send"
            autoFocus={autoFocus}
            value={value}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            className="field-sizing-content max-h-[40dvh] min-h-10 px-3 py-2 text-[15px]"
            onChange={(e) => {
              onChange(e.target.value);
              trackMention(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => trackMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onBlur={mention.close}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        )}
        <InputGroupAddon align="block-end" className="gap-0.5 px-1.5 pb-1.5">
          {!minimal && (
            <>
              <Tool label="Attach files or images" onClick={() => file.current?.click()}>
                <PaperclipIcon />
              </Tool>
              <input
                ref={file}
                type="file"
                hidden
                multiple
                accept=".txt,.md,.json,.csv,.log,.ts,.js,.py,text/*,image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void addFiles(picked);
                }}
              />
              {instructions && (
                <Tool label="Use an instruction (/)" onClick={openInstructions}>
                  <BookOpenIcon />
                </Tool>
              )}
              <Popover
                open={!!picker}
                onOpenChange={(open) => {
                  if (!open) setPicker(undefined);
                }}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PopoverTrigger
                        render={
                          <InputGroupButton
                            size="icon-xs"
                            aria-label="Server files"
                            onClick={() => openFiles("shared")}
                          />
                        }
                      />
                    }
                  >
                    <FolderOpenIcon />
                  </TooltipTrigger>
                  <TooltipContent>Server files</TooltipContent>
                </Tooltip>
                <PopoverContent align="start" className="w-72 p-2 text-sm">
                  <p className="truncate px-1 pb-1 text-xs font-medium text-muted-foreground">
                    {picker?.path}
                  </p>
                  <ul className="max-h-60 overflow-y-auto">
                    {picker?.entries.map((en) => (
                      <li key={en.name}>
                        <button
                          type="button"
                          className="w-full truncate rounded px-1.5 py-1 text-left hover:bg-muted"
                          onClick={() => {
                            const p = `${picker.path}/${en.name}`;
                            if (en.kind === "dir") openFiles(p);
                            else {
                              setFileRefs((r) => [...r, p]);
                              setPicker(undefined);
                            }
                          }}
                        >
                          {en.kind === "dir" ? "📂" : "📄"} {en.name}
                        </button>
                      </li>
                    ))}
                    {picker?.entries.length === 0 && (
                      <li className="px-1.5 py-1 text-muted-foreground">
                        Empty. Put files under the server's files folder.
                      </li>
                    )}
                  </ul>
                </PopoverContent>
              </Popover>
              <Tool
                label="Mention a bot"
                onClick={() => {
                  onChange(`${value}${value && !value.endsWith(" ") ? " " : ""}@`);
                  requestAnimationFrame(() => {
                    const el = input.current;
                    if (!el) return;
                    el.focus();
                    const end = el.value.length;
                    el.setSelectionRange(end, end);
                    trackMention(el.value, end);
                  });
                }}
              >
                <AtIcon />
              </Tool>
            </>
          )}
          <span className="flex-1" />
          <span className="hidden pr-2 text-[11px] text-muted-foreground sm:inline">
            <kbd className="font-sans font-medium">Shift + Return</kbd> for a new line
          </span>
          {busy && onStop && (
            <InputGroupButton size="icon-sm" variant="outline" aria-label="Stop" onClick={onStop}>
              <SquareIcon weight="fill" />
            </InputGroupButton>
          )}
          {/* While the bot works, a message is queued and answered in its own thread. */}
          {(!busy || !onStop || canSend) && (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              aria-label={busy ? "Send; it waits until the bot finishes" : "Send"}
              disabled={!canSend}
              className="data-disabled:bg-muted data-disabled:text-muted-foreground"
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

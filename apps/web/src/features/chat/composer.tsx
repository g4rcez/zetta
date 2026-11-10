import { Alert } from "@g4rcez/components/alert";
import { looksSecret } from "@zetta/core/secrets";
import type { EditorView } from "@codemirror/view";
import { uuidv7 } from "@zetta/core/uuid";
import { Link } from "@tanstack/react-router";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  ArrowBendUpLeftIcon,
  ArrowUpIcon,
  AtIcon,
  TextBIcon,
  BrainIcon,
  CodeIcon,
  EyeIcon,
  FolderOpenIcon,
  LightningIcon,
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
import { InputGroup, InputGroupAddon, InputGroupButton } from "@zetta/ui/components/input-group";
import { ActionHint } from "@/components/action-hint";
import { Button, Dropdown, Separator } from "@/components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@zetta/ui/lib/utils";

import { ImageViewer } from "./attachment-image";
import {
  IMAGE_MAX_BYTES,
  listFiles,
  uploadAttachment,
  uploadImage,
  type Attachment as Attached,
  type Bot,
} from "./chat-client";
import { matchTrigger } from "./triggers";
import { MentionPopup, useMention } from "./mention";
import { chatQueries } from "./chat-queries";
import { memoryQueries } from "../memory/memory-api";
import { BotAvatar } from "@/components/bot-avatar";
import { Editor } from "@/components/editor/editor";
import { BotIdentity, BotsContext } from "@/components/bot-identity";
import { Response } from "./response";

export type Outgoing = {
  text: string;
  attachmentIds: string[];
  fileRefs: string[];
  memoryIds?: string[];
  /** Skills picked with `/`; `botId` is the bot that owns the skill (in a room, the one that uses it). */
  skills?: { botId: string; name: string }[];
};
/** A skill of a bot that the person can pick with `/`: the bot uses it for this message. */
type SkillItem = { botId: string; name: string; description: string };
/** What `/` picked: a memory item or a skill. Both count toward MAX_PICKED. */
type Picked = { kind: "memory"; item: MemoryItem } | ({ kind: "skill" } & SkillItem);
/** A row of the `/` list, in the order the arrow keys walk it. */
type Candidate = Picked;
/** Rows sit in groups under a heading: one group per bot's skills, then the memory. */
const groupOf = (c: Candidate) => (c.kind === "memory" ? "memory" : c.botId);
const sameSkill = (a: SkillItem, b: SkillItem) => a.botId === b.botId && a.name === b.name;
/** A memory item the person can pick with `/`: the bot follows it for this message. */
type MemoryItem = {
  id: string;
  title: string;
  howto: string;
  tags: string[];
  status: string;
  score: number;
};
const PICTURES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_ATTACHMENTS = 5;
const MAX_PICKED = 5;
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
    <ActionHint label={label}>
      <InputGroupButton
        size="icon-xs"
        aria-label={label}
        aria-pressed={pressed}
        className={cn(pressed && "bg-muted text-foreground")}
        onClick={onClick}
      >
        {children}
      </InputGroupButton>
    </ActionHint>
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
  memory,
  skillBots = [],
  replyTo,
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
  /** Turn on the `/` picker: only for screens whose submit forwards `memoryIds`. */
  memory?: boolean;
  /** Bots whose skills the `/` picker lists (the chat's bot; in a room, its members). Needs `memory`, since both share the picker. */
  skillBots?: readonly string[];
  /** Text only: no attachments, server files or @mentions (the setup interview). */ minimal?: boolean;
  /** The message the next send replies to in this channel (not a thread): shown as a chip, and the cursor moves into the box when it changes. */
  replyTo?: { id: string; name: string; excerpt: string; onCancel: () => void } | undefined;
}) {
  const qc = useQueryClient();
  const input = useRef<EditorView>(null);
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
  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId) input.current?.focus();
  }, [replyId]);
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [picker, setPicker] = useState<{
    path: string;
    entries: { name: string; kind: "file" | "dir" }[];
  }>();
  const [previewing, setPreviewing] = useState(false);
  const mention = useMention({ bots, viewRef: input, onError });
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const [slash, setSlash] = useState<{ query: string; at: number; index: number }>();
  const [library, setLibrary] = useState<MemoryItem[]>();
  const [skillLib, setSkillLib] = useState<SkillItem[]>();
  const skillsAsked = useRef(false);
  const [chosen, setChosen] = useState<Picked[]>([]);
  const query = slash?.query.toLowerCase() ?? "";
  const skillCandidates: Candidate[] =
    slash && skillLib
      ? skillLib
          .filter(
            (k) =>
              !chosen.some((c) => c.kind === "skill" && sameSkill(c, k)) &&
              `${k.name} ${k.description}`.toLowerCase().includes(query),
          )
          .slice(0, 6)
          .map((k) => ({ kind: "skill", ...k }))
      : [];
  const memoryCandidates: Candidate[] =
    slash && library
      ? library
          .filter(
            (i) =>
              !chosen.some((c) => c.kind === "memory" && c.item.id === i.id) &&
              `${i.title} ${i.tags.join(" ")}`.toLowerCase().includes(query),
          )
          .slice(0, 6)
          .map((item) => ({ kind: "memory", item }))
      : [];
  const candidates = [...skillCandidates, ...memoryCandidates];
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
  async function addFiles(picked: File[]) {
    // A pasted or dropped File can be a lazy reference that the browser invalidates after the
    // event (NotReadableError). Start every read now, in the event tick, and work on the copies.
    let files: File[];
    try {
      files = await Promise.all(
        picked.map(async (f) => new File([await f.arrayBuffer()], f.name, { type: f.type })),
      );
    } catch {
      onError(
        new Error("The browser could not read the pasted file. Save it and attach it again."),
      );
      return;
    }
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
  function onPaste(e: ClipboardEvent) {
    const pics = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (!pics.length) return;
    if (!e.clipboardData?.getData("text/plain")) e.preventDefault();
    void addFiles(pics);
  }

  function wrap(before: string, after = before) {
    const view = input.current;
    if (!view) return;
    const { from, to } = view.state.selection.main,
      picked = view.state.sliceDoc(from, to) || "text";
    view.dispatch({
      changes: { from, to, insert: before + picked + after },
      selection: { anchor: from + before.length, head: from + before.length + picked.length },
    });
    view.focus();
  }
  function trackMention(text: string, caret: number) {
    mention.track(text, caret);
    const s = memory ? matchTrigger(text, caret, "/") : undefined;
    setSlash(s ? { ...s, index: 0 } : undefined);
    // A bot that fails to answer (or has no skills) just adds none: the memory part of the list still works.
    if (s && !skillsAsked.current && skillBots.length && chosen.length < MAX_PICKED) {
      skillsAsked.current = true;
      void Promise.all(
        skillBots.map((id) =>
          qc
            .fetchQuery(chatQueries.skills(id))
            .then((l) => l.map((k) => ({ botId: id, ...k })))
            .catch(() => []),
        ),
      ).then((l) => setSkillLib(l.flat()));
    }
    if (s && !library && chosen.length < MAX_PICKED)
      void qc.fetchQuery(memoryQueries.index()).then(
        (r) =>
          setLibrary(
            [...r.pages, ...r.shared]
              .filter((p) => p.status !== "archived")
              // Procedures first, then the most important.
              .sort(
                (a, b) =>
                  Number(b.tags.includes("instruction")) - Number(a.tags.includes("instruction")) ||
                  b.score - a.score,
              ),
          ),
        onError,
      );
  }
  function openPicker() {
    const view = input.current;
    if (!view) return;
    const { from, to } = view.state.selection.main,
      pad = from > 0 && !/\s/.test(view.state.sliceDoc(from - 1, from)) ? " " : "";
    // The editor reports the new caret, and `trackMention` opens the list from it.
    view.dispatch({
      changes: { from, to, insert: `${pad}/` },
      selection: { anchor: from + pad.length + 1 },
    });
    view.focus();
  }
  function pickItem(i: Candidate) {
    if (!slash) return;
    const view = input.current;
    if (!view) return;
    const end = slash.at + 1 + slash.query.length;
    view.dispatch({
      changes: { from: slash.at, to: end + (view.state.sliceDoc(end, end + 1) === " " ? 1 : 0) },
      selection: { anchor: slash.at },
    });
    setChosen((l) => (l.length < MAX_PICKED ? [...l, i] : l));
    setSlash(undefined);
    view.focus();
  }
  const memoryPicks = chosen.filter((c) => c.kind === "memory");
  const skillPicks = chosen.filter((c) => c.kind === "skill");
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
      ...(memoryPicks.length ? { memoryIds: memoryPicks.map((c) => c.item.id) } : {}),
      ...(skillPicks.length
        ? { skills: skillPicks.map((c) => ({ botId: c.botId, name: c.name })) }
        : {}),
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
  function onKeyDown(e: KeyboardEvent) {
    if (slash && candidates.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSlash({
          ...slash,
          index: (slash.index + d + candidates.length) % candidates.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickItem(candidates[slash.index]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(undefined);
        return;
      }
    }
    if (mention.onKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      if (picker) setPicker(undefined);
      else if (previewing) setPreviewing(false);
      else if (replyTo) replyTo.onCancel();
      else input.current?.contentDOM.blur();
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
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary"
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
      {slash && (library || skillLib) && (
        <ul
          role="listbox"
          aria-label="Use a skill or follow a memory item"
          className="absolute bottom-full left-0 z-20 mb-1 w-80 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
        >
          {candidates.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground" role="presentation">
              {!skillLib?.length && library?.length === 0 ? "Nothing to pick yet. " : "No match."}
              {!skillLib?.length && library?.length === 0 && (
                <Link
                  to="/memory"
                  onMouseDown={(e) => e.preventDefault()}
                  className="underline hover:text-foreground"
                >
                  Create a memory item
                </Link>
              )}
            </li>
          )}
          {candidates.map((c, k) => (
            <Fragment key={c.kind === "memory" ? c.item.id : `${c.botId}/${c.name}`}>
              {(k === 0 || groupOf(c) !== groupOf(candidates[k - 1]!)) && (
                <li
                  className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground"
                  role="presentation"
                >
                  {c.kind === "memory" ? (
                    <>
                      Memory
                      <Link
                        to="/memory"
                        onMouseDown={(e) => e.preventDefault()}
                        className="underline hover:text-foreground"
                      >
                        Manage
                      </Link>
                    </>
                  ) : skillBots.length > 1 && botsById.get(c.botId) ? (
                    <BotIdentity bot={botsById.get(c.botId)!} size={16} />
                  ) : (
                    "Skills"
                  )}
                </li>
              )}
              <li
                role="option"
                aria-selected={k === slash.index}
                title={c.kind === "memory" ? c.item.howto : c.description}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickItem(c);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  k === slash.index ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                {c.kind === "memory" ? (
                  <BrainIcon className="size-4 shrink-0" />
                ) : (
                  <LightningIcon className="size-4 shrink-0" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {c.kind === "memory" ? c.item.title : c.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.kind === "memory" ? c.item.howto : c.description}
                  </span>
                </span>
              </li>
            </Fragment>
          ))}
        </ul>
      )}
      <MentionPopup mention={mention} placement="above" />
      <InputGroup className="h-auto rounded-xl border-border bg-card focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        {replyTo && (
          <InputGroupAddon align="block-start" className="border-b px-2 py-1.5">
            <div className="flex w-full min-w-0 items-center gap-2 text-xs">
              <ArrowBendUpLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Replying to <b className="font-semibold">{replyTo.name}</b>
                <span className="text-muted-foreground"> · {replyTo.excerpt}</span>
              </span>
              <ActionHint label="Cancel reply">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Cancel reply"
                  onClick={replyTo.onCancel}
                >
                  <XIcon />
                </Button>
              </ActionHint>
            </div>
          </InputGroupAddon>
        )}
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
                  <ActionHint label={`Preview ${x.name}`}>
                    <button
                      type="button"
                      disabled={x.uploading}
                      aria-label={`Preview ${x.name}`}
                      onClick={() => setViewing(pictures.findIndex((p) => p.key === x.key))}
                      className="block size-16 cursor-zoom-in overflow-hidden rounded-lg border bg-muted outline-offset-2 focus-visible:outline-2 disabled:cursor-progress"
                    >
                      {/* No zoom: the thumbnail is a button that opens `ImageViewer`, which zooms. */}
                      <img
                        src={x.preview}
                        alt={x.name}
                        className={cn("size-full object-cover", x.uploading && "opacity-50")}
                      />
                    </button>
                  </ActionHint>
                  {x.uploading && (
                    <CircleNotchIcon
                      aria-label="Uploading"
                      className="pointer-events-none absolute inset-0 m-auto size-5 animate-spin text-foreground"
                    />
                  )}
                  <ActionHint label={`Remove ${x.name}`}>
                    <button
                      type="button"
                      aria-label={`Remove ${x.name}`}
                      onClick={() => dropStaged(x.key)}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:text-foreground"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </ActionHint>
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
              {chosen.map((c) => {
                const key = c.kind === "memory" ? c.item.id : `${c.botId}/${c.name}`;
                const title = c.kind === "memory" ? c.item.title : c.name;
                const owner =
                  c.kind === "skill" && skillBots.length > 1 ? botsById.get(c.botId) : undefined;
                return (
                  <Attachment
                    key={key}
                    size="sm"
                    title={c.kind === "memory" ? c.item.howto : c.description}
                  >
                    <AttachmentMedia>
                      {c.kind === "memory" ? <BrainIcon /> : <LightningIcon />}
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle className="flex max-w-40 items-center gap-1 truncate">
                        {owner && <BotAvatar bot={owner} size={14} />}
                        {title}
                      </AttachmentTitle>
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction
                        aria-label={`Remove ${title}`}
                        onClick={() =>
                          setChosen((l) =>
                            l.filter((x) =>
                              x.kind === "memory"
                                ? c.kind !== "memory" || x.item.id !== c.item.id
                                : c.kind !== "skill" || !sameSkill(x, c),
                            ),
                          )
                        }
                      >
                        <XIcon />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                );
              })}
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
              <BotsContext.Provider value={botsById}>
                <Response text={value} />
              </BotsContext.Provider>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <Editor
            viewRef={input}
            extensions={mention.extensions}
            aria-label="Message"
            enterKeyHint="send"
            autoFocus={autoFocus}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            className="min-h-10 w-full px-3 py-2 text-sm [--editor-max-height:40dvh]"
            onChange={onChange}
            onSelect={trackMention}
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
              {memory && (
                <Tool label="Use a memory item (/)" onClick={openPicker}>
                  <BrainIcon />
                </Tool>
              )}
              <Dropdown
                asChild
                open={!!picker}
                onChange={(open) => {
                  if (!open) setPicker(undefined);
                }}
                aria-label="Server files"
                trigger={
                  <ActionHint label="Server files">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Server files"
                      onClick={() => (picker ? setPicker(undefined) : openFiles("shared"))}
                    >
                      <FolderOpenIcon />
                    </InputGroupButton>
                  </ActionHint>
                }
              >
                <div className="w-64 max-w-[calc(100vw-4rem)] text-sm">
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
                </div>
              </Dropdown>
              <Tool
                label="Mention a bot"
                onClick={() => {
                  const view = input.current;
                  if (!view) return;
                  const end = view.state.doc.length,
                    pad = end && view.state.sliceDoc(end - 1, end) !== " " ? " " : "";
                  // The editor reports the new caret, and `trackMention` opens the list from it.
                  view.dispatch({
                    changes: { from: end, insert: `${pad}@` },
                    selection: { anchor: end + pad.length + 1 },
                  });
                  view.focus();
                }}
              >
                <AtIcon />
              </Tool>
            </>
          )}
          <span className="flex-1" />
          <span className="hidden pr-2 text-xs text-muted-foreground sm:inline">
            <kbd className="font-sans font-medium">Shift + Return</kbd> for a new line
          </span>
          {busy && onStop && (
            <ActionHint label="Stop">
              <InputGroupButton size="icon-sm" variant="outline" aria-label="Stop" onClick={onStop}>
                <SquareIcon weight="fill" />
              </InputGroupButton>
            </ActionHint>
          )}
          {/* While the bot works, a message waits and is answered with the others that wait when the reply ends. */}
          {(!busy || !onStop || canSend) && (
            <ActionHint label={busy ? "Send; it waits until the bot finishes" : "Send"}>
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                aria-label={busy ? "Send; it waits until the bot finishes" : "Send"}
                disabled={!canSend}
                className="size-7 rounded-full data-disabled:bg-muted data-disabled:text-muted-foreground"
              >
                <ArrowUpIcon />
              </InputGroupButton>
            </ActionHint>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

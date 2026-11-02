import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type RefObject,
} from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ComputerActivity } from "../computer/computer-activity";
import { DesktopButton } from "../computer/desktop-button";
import {
  CaretRightIcon,
  LockIcon,
  ShareNetworkIcon,
  SidebarSimpleIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { BotsContext } from "@/components/bot-identity";
import { LatestChatsContext } from "@/components/bot-tag";
import { motion, useReducedMotion } from "motion/react";
import { ChatDetails } from "./chat-details";
import { ArtifactPanel } from "./artifact-panel";
import { ThreadTabs } from "./thread-tabs";
import { Skeleton } from "@g4rcez/components";

import { Button } from "@zetta/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@zetta/ui/components/sheet";
import { cn } from "@zetta/ui/lib/utils";
import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot, BotStatusLabel } from "@/components/bot-status";
import { ResizeHandle, toWidth } from "@/components/resize-handle";
import { authClient } from "@/lib/auth-client";
import { useMedia } from "@/lib/use-media";

import { refreshAttention } from "../attention/summary";
import {
  chatClient,
  errorMessage,
  type Conversation,
  type Message,
  type Proposal,
} from "./chat-client";
import { asRow, shouldAutoOpen, transcriptRows, type Row } from "./chat-rows";
import { Composer } from "./composer";
import { MessageList, type RowActions } from "./message-list";
import { SetupActionsContext, type SetupActions } from "./setup-actions";
import type { Author } from "./message-row";
import { ProposalsPanel } from "./proposals-panel";
import { LoopBanner, useGoalLoop } from "./loop-banner";
import { PublishDialog } from "./publish-dialog";
import { toggleReaction } from "./reactions";
import { useSidebarData } from "./sidebar-data";
import { ThreadPanel } from "./thread-panel";
import { draftKey, useDraft } from "./use-draft";
import { useZettaChat } from "./use-zetta-chat";
import { Alert } from "@g4rcez/components/alert";

const SUGGESTIONS = [
  "What can you help me with?",
  "Summarize what you remember about me.",
  "Plan my week.",
];

type DraftHandle = ReturnType<typeof useDraft>;
/** The composer owns its draft text, so each keystroke renders this component and not the whole page. `handle` gives the page adopt/clear. */
function DraftComposer({
  storageKey,
  handle,
  ...props
}: Omit<ComponentProps<typeof Composer>, "value" | "onChange"> & {
  storageKey: string | undefined;
  handle: RefObject<DraftHandle | null>;
}) {
  const draft = useDraft(storageKey);
  handle.current = draft;
  return <Composer {...props} value={draft.value} onChange={draft.set} />;
}

const NEW_CHAT = "new";
const LAST_CHAT_KEY = "zetta:last-chat";
const readLastChat = () => {
  try {
    return localStorage.getItem(LAST_CHAT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
// The artifact panel width is a per-browser layout choice. 448 is the old 28rem minimum.
const ARTIFACT_WIDTH_KEY = "zetta.artifact-width";
const ARTIFACT_LIMITS = { min: 448, max: 1024, fallback: 640 } as const;
const readArtifactWidth = () => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ARTIFACT_WIDTH_KEY) ?? "null");
    return typeof raw === "number" && Number.isFinite(raw)
      ? toWidth(raw, ARTIFACT_LIMITS.min, ARTIFACT_LIMITS.max)
      : ARTIFACT_LIMITS.fallback;
  } catch {
    return ARTIFACT_LIMITS.fallback;
  }
};
const writeArtifactWidth = (width: number) => {
  try {
    localStorage.setItem(ARTIFACT_WIDTH_KEY, String(width));
  } catch {
    // Storage unavailable (private mode): the width just lasts for this session.
  }
};
type ChatSearchState = {
  thread?: string | undefined;
  bot?: string | undefined;
  artifact?: string | undefined;
};

export function ChatPage() {
  // The URL owns which chat is open: /chat/<conversationId>, /chat/new?bot=<botId> (empty draft) or a bare /chat (resolved below). Nothing else decides it.
  const search = useSearch({ from: "/_auth/chat/{-$chatId}" });
  const params = useParams({ from: "/_auth/chat/{-$chatId}" });
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { bots, setBots, refreshBots, chats, setChats, chatsLoaded, loadChats } = useSidebarData();
  const [saved, setSaved] = useState<Message[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [details, setDetails] = useState(false); // the context panel's bot and files view
  const [artifactWidth, setArtifactWidth] = useState(readArtifactWidth);
  const reduceMotion = useReducedMotion();
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sent, setSent] = useState(0); // bumps on every send so the list jumps to the newest message
  const desktop = useMedia("(min-width: 1024px)");
  const fail = (e: unknown) => setError(errorMessage(e));
  const threadId = search.thread;
  const urlChat = params.chatId;
  const chatId = urlChat && urlChat !== NEW_CHAT ? urlChat : undefined;
  // A routine's chat is not in the sidebar list (`chats`): it is opened from Routines, so it is looked up by id.
  const [lookup, setLookup] = useState<{ id: string; row?: Conversation }>();
  const listedRow = chatId ? chats.find((c) => c.id === chatId) : undefined;
  const lookedUp = lookup?.id === chatId;
  const openChatRow = listedRow ?? (lookedUp ? lookup?.row : undefined);
  useEffect(() => {
    if (!chatId || !chatsLoaded || listedRow || lookedUp) return;
    let live = true;
    chatClient
      .conversation(chatId)
      .then((row) => live && setLookup({ id: chatId, row }))
      .catch(() => live && setLookup({ id: chatId }));
    return () => {
      live = false;
    };
  }, [chatId, chatsLoaded, listedRow, lookedUp]);
  const defaultBot =
    bots.find((b) => b.id === search.bot) ?? bots.find((b) => b.kind === "chief") ?? bots[0];
  // A conversation decides its bot; a draft (or a bare /chat) takes the bot from ?bot=, falling back to the chief.
  const botId = chatId ? openChatRow?.botId : defaultBot?.id;
  const draft = useRef<DraftHandle | null>(null);

  const toChat = (id: string, replace = false) =>
    void navigate({ to: "/chat/{-$chatId}", params: { chatId: id }, search: {}, replace });
  const toDraft = (bot: string, replace = false) =>
    void navigate({
      to: "/chat/{-$chatId}",
      params: { chatId: NEW_CHAT },
      search: { bot },
      replace,
    });
  // Picking a bot opens its latest conversation, or an empty draft when it has none.
  const toBot = (bot: string, replace = false) => {
    const latest = chats.find((c) => c.botId === bot);
    if (latest) toChat(latest.id, replace);
    else toDraft(bot, replace);
  };
  // The side pane holds one thing at a time: opening a thread closes the artifact and the other way round.
  const setThread = (id?: string) =>
    void navigate({
      to: ".",
      search: (s: ChatSearchState) => ({
        ...s,
        thread: id,
        ...(id ? { artifact: undefined } : {}),
      }),
      replace: true,
    });
  const setArtifact = (id?: string) =>
    void navigate({
      to: ".",
      search: (s: ChatSearchState) => ({
        ...s,
        artifact: id,
        ...(id ? { thread: undefined } : {}),
      }),
      replace: true,
    });

  const loadProposals = useCallback(
    () =>
      chatClient
        .proposals()
        .then(setProposals)
        .catch(() => {}),
    [],
  );
  // Proposals also come from loops, routines and other chats, which send no stream part: poll while the tab is visible.
  useEffect(() => {
    void loadProposals();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadProposals();
    }, 5_000);
    return () => clearInterval(t);
  }, [loadProposals]);
  // Remember the open conversation so the rail's Chat item returns to it.
  useEffect(() => {
    if (!openChatRow) return;
    try {
      localStorage.setItem(LAST_CHAT_KEY, openChatRow.id);
    } catch {
      // storage unavailable: the last chat just won't persist
    }
  }, [openChatRow?.id]);
  // A bare /chat has no state of its own: it becomes the last used conversation, else the default bot's latest. A chat that no longer exists falls back to the default bot.
  useEffect(() => {
    if (!chatsLoaded || !bots.length) return;
    if (!urlChat || (chatId && !openChatRow && lookedUp)) {
      const last = !urlChat ? readLastChat() : undefined;
      if (last && chats.some((c) => c.id === last)) toChat(last, true);
      else if (defaultBot) toBot(defaultBot.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsLoaded, bots, urlChat, chatId, openChatRow, lookedUp, defaultBot?.id]);
  const reload = useCallback(async (id: string) => {
    try {
      const list = await chatClient.messages(id);
      setSaved(list);
    } catch (e) {
      fail(e);
    }
  }, []);
  useEffect(() => {
    if (!chatId) {
      setSaved([]);
      setLoadingMessages(false);
      return;
    }
    let live = true;
    setLoadingMessages(true);
    chatClient
      .messages(chatId)
      .then((list) => {
        if (live) setSaved(list);
      })
      .catch((e) => {
        if (live) fail(e);
      })
      .finally(() => {
        if (live) setLoadingMessages(false);
      });
    return () => {
      live = false;
    };
  }, [chatId]);

  const settle = useCallback(
    async (id: string) => {
      await reload(id);
      void loadChats().catch(() => {});
      void loadProposals();
      void refreshAttention();
      // The chief may have just created bots: show them in the list and make their cards open.
      void chatClient
        .bots()
        .then(setBots)
        .catch(() => {});
    },
    [reload, loadChats, loadProposals],
  );
  // Artifacts this page already tried to open: a stream replayed on resume must not reopen the pane.
  const autoOpened = useRef(new Set<string>());
  const main = useZettaChat({
    conversationId: chatId,
    onSettled: settle,
    onProposal: () => void loadProposals(),
    // The history poll pauses while the chat is busy, so the notes the bot just took are reloaded here.
    onSteer: () => void (chatId && reload(chatId)),
    onArtifact: ({ id, at }) => {
      const open = shouldAutoOpen({
        desktop,
        paneOpen: !!(search.thread || search.artifact || details),
        seen: autoOpened.current,
        id,
        at,
      });
      autoOpened.current.add(id);
      if (open) setArtifact(id);
    },
  });
  // A running goal loop starts each step on the server: follow it live, and reload when it moves on.
  // The server answers queued messages one after another, each in its thread: follow each answer live and refresh until none waits.
  const waiting = saved.some((m) => m.queue === "pending" || m.queue === "running");
  const follow = useRef(main);
  follow.current = main;
  useEffect(() => {
    if (!chatId || !waiting || main.busy) return;
    follow.current.reattach();
    const t = setInterval(() => {
      void reload(chatId);
      follow.current.reattach();
    }, 2_000);
    return () => clearInterval(t);
  }, [chatId, waiting, main.busy, reload]);
  const goal = useGoalLoop(
    chatId,
    () => main.reattach(),
    () => {
      if (chatId) void reload(chatId);
      void loadProposals();
    },
  );

  const current = bots.find((b) => b.id === botId);
  const meName = session?.user.name ?? "You",
    meImage = session?.user.image;
  // Author objects are cached so memoized rows see the same one on every render; the cache resets when its inputs change.
  const authorOf = useMemo(() => {
    const cache = new Map<string, Author>();
    const once = (key: string, make: () => Author) => {
      let a = cache.get(key);
      if (!a) cache.set(key, (a = make()));
      return a;
    };
    return (row: Row): Author => {
      // Outside people writing through a channel plugin are not the signed-in user.
      if (row.role === "user" && row.meta?.inbound) {
        const { label, chatName } = row.meta.inbound;
        return once(`in:${label}:${chatName}`, () => ({ name: `${label} · ${chatName}` }));
      }
      if (row.role === "user") return once("me", () => ({ name: meName, image: meImage }));
      const id = row.botId ?? botId;
      return once(`bot:${id}:${row.botName ?? ""}`, () => {
        const bot = bots.find((b) => b.id === id);
        return { name: bot?.name ?? row.botName ?? "Bot", bot };
      });
    };
  }, [bots, botId, meName, meImage]);

  const rows = useMemo(() => transcriptRows(saved, main.rows), [saved, main.rows]);
  const thread = threadId
    ? (rows.find((r) => r.id === threadId) ?? saved.map(asRow).find((r) => r.id === threadId))
    : undefined;
  const replies = useMemo(
    () => (threadId ? saved.filter((m) => m.parentMessageId === threadId).map(asRow) : []),
    [saved, threadId],
  );

  async function send({
    text,
    attachmentIds,
    fileRefs,
    wikiIds,
  }: {
    text: string;
    attachmentIds: string[];
    fileRefs: string[];
    wikiIds?: string[] | undefined;
  }) {
    if (!botId) return false;
    setError(undefined);
    try {
      let id = chatId;
      if (!id) {
        draft.current?.adopt();
        const created = await chatClient.startConversation(botId);
        id = created.id;
        setChats((c) => [created, ...c]);
        toChat(id, true);
      }
      draft.current?.clear();
      setSent((n) => n + 1);
      void main.send(text, { conversationId: id, attachmentIds, fileRefs, wikiIds }).catch(fail);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  // A setup card in a reply says "set up" in this chat once the person finishes it. It always calls the latest send.
  const sendRef = useRef(send);
  sendRef.current = send;
  // Bots by id: `Response` draws the bot names of a message as tags.
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  // `chats` is newest first, so the first chat of a bot is its latest.
  const latestChats = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of chats) if (c.botId && !map.has(c.botId)) map.set(c.botId, c.id);
    return map;
  }, [chats]);
  const setupActions = useMemo<SetupActions>(
    () => ({ say: (text) => void sendRef.current({ text, attachmentIds: [], fileRefs: [] }) }),
    [],
  );
  const setReactions = (id: string, reactions: Message["reactions"]) =>
    setSaved((l) => l.map((m) => (m.id === id ? { ...m, reactions } : m)));
  async function toggleReact(m: Row, emoji: string) {
    const before = m.reactions ?? [],
      wasMine = before.some((r) => r.emoji === emoji && r.mine);
    setReactions(m.id, toggleReaction(before, emoji));
    try {
      await (wasMine ? chatClient.unreact(m.id, emoji) : chatClient.react(m.id, emoji));
    } catch (e) {
      setReactions(m.id, before);
      fail(e);
    }
  }
  // Stable identity: memoized rows must not re-render because the page did. Handlers read the latest closure through a ref.
  const latestActions = useRef<RowActions>(null as never);
  latestActions.current = {
    onReact: (row, emoji) => void toggleReact(row, emoji),
    onReply: (row) => setThread(row.id),
    onOpenArtifact: (id) => setArtifact(id),
    onSaveToWiki: (row) =>
      void chatClient
        .saveToWiki(`From chat: ${row.content.slice(0, 40)}`, row.content)
        .then(() => setNotice("Saved to your wiki."), fail),
    onQueue: (row, action) => {
      if (!chatId) return;
      void (
        action === "remove"
          ? chatClient.removeQueued(chatId, row.id)
          : chatClient.retryQueued(chatId, row.id)
      ).then(() => reload(chatId), fail);
    },
  };
  const actions = useMemo<RowActions>(
    () => ({
      onReact: (row, emoji) => latestActions.current.onReact(row, emoji),
      onReply: (row) => latestActions.current.onReply(row),
      onSaveToWiki: (row) => latestActions.current.onSaveToWiki(row),
      onQueue: (row, action) => latestActions.current.onQueue?.(row, action),
      onOpenArtifact: (id) => latestActions.current.onOpenArtifact?.(id),
    }),
    [],
  );
  function openChat(id: string) {
    toChat(id);
  }
  // Threads: a delete waits a few seconds so Undo can bring the thread back untouched.
  const [undoDelete, setUndoDelete] = useState<Conversation>();
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitDelete = (c: Conversation) =>
    void chatClient.deleteConversation(c.id).catch((e) => {
      setChats((all) => (all.some((x) => x.id === c.id) ? all : [c, ...all]));
      fail(e);
    });
  function deleteThread(id: string) {
    const gone = chats.find((c) => c.id === id);
    if (!gone) return;
    if (undoDelete) {
      clearTimeout(deleteTimer.current);
      commitDelete(undoDelete);
    }
    const rest = chats.filter((c) => c.id !== id);
    setChats(rest);
    setUndoDelete(gone);
    deleteTimer.current = setTimeout(() => {
      commitDelete(gone);
      setUndoDelete(undefined);
    }, 6000);
    if (id === chatId) {
      const next = rest.find((c) => c.botId === gone.botId);
      if (next) toChat(next.id, true);
      else toDraft(gone.botId, true);
    }
  }
  function undoDeleteThread() {
    if (!undoDelete) return;
    clearTimeout(deleteTimer.current);
    const back = undoDelete;
    setChats((all) => [back, ...all]);
    setUndoDelete(undefined);
    toChat(back.id);
  }
  function updateThread(
    id: string,
    patch: { title?: string; archived?: boolean; favorite?: boolean },
  ) {
    const before = chats;
    const row = chats.find((c) => c.id === id);
    setChats((all) =>
      patch.archived
        ? all.filter((c) => c.id !== id)
        : all.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
    if (patch.archived && id === chatId && row) {
      const next = chats.find((c) => c.botId === row.botId && c.id !== id);
      if (next) toChat(next.id, true);
      else toDraft(row.botId, true);
    }
    chatClient.updateConversation(id, patch).then(
      (saved) => {
        if (!saved.archived)
          setChats((all) =>
            all.some((c) => c.id === id)
              ? all.map((c) => (c.id === id ? { ...c, ...saved } : c))
              : [saved, ...all],
          );
      },
      (e) => {
        setChats(before);
        fail(e);
      },
    );
  }
  // `#` is for rooms; a bot is a direct message, so a team bot gets a people mark instead.
  const ChannelIcon = current?.visibility === "private" ? LockIcon : UsersIcon;

  const threadPane =
    thread && chatId ? (
      <ThreadPanel
        key={thread.id}
        conversationId={chatId}
        parent={thread}
        replies={replies}
        streamed={main.rows.filter((r) => r.parentMessageId === thread.id)}
        bots={bots}
        bot={current}
        authorOf={authorOf}
        actions={actions}
        onClose={() => setThread(undefined)}
        onSettled={settle}
        onProposal={() => void loadProposals()}
        onError={fail}
      />
    ) : null;
  const artifactPane = search.artifact ? (
    <ArtifactPanel
      key={search.artifact}
      id={search.artifact}
      onClose={() => setArtifact(undefined)}
    />
  ) : null;
  // DESIGN.md "Shell": one context panel on demand: an open artifact or thread takes it, otherwise the details view.
  const sidePane =
    artifactPane ??
    threadPane ??
    (details ? (
      <ChatDetails
        bot={current}
        files={rows.flatMap((r) => r.attachments ?? [])}
        onClose={() => setDetails(false)}
      />
    ) : null);

  return (
    <BotsContext.Provider value={botsById}>
      <LatestChatsContext.Provider value={latestChats}>
        <div
          className={cn(
            "grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)]",
            sidePane &&
              desktop &&
              (artifactPane
                ? // A file needs room: the width the person dragged it to, capped so the chat stays usable.
                  "lg:grid-cols-[minmax(0,1fr)_var(--artifact-width)]"
                : "lg:grid-cols-[minmax(0,1fr)_22.5rem]"),
          )}
          style={
            artifactPane
              ? ({ "--artifact-width": `min(${artifactWidth}px, 65%)` } as CSSProperties)
              : undefined
          }
        >
          <section
            className="flex min-h-0 min-w-0 flex-col bg-background"
            aria-label={current ? `Channel ${current.name}` : "Chat"}
          >
            <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
              {(() => {
                const content = (
                  <>
                    {current ? (
                      <BotAvatar
                        bot={current}
                        size={24}
                        square
                        badge={<BotStatusDot botId={current.id} className="border-background" />}
                      />
                    ) : (
                      <ChannelIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <h2 className="truncate text-sm font-medium text-muted-foreground">
                      {current?.name ?? "Chat"}
                    </h2>
                    {current && (
                      <ChannelIcon
                        aria-label={current.visibility === "private" ? "Private" : "Team"}
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    {current && <BotStatusLabel botId={current.id} />}
                    {/* The link's name keeps its visible text first (WCAG 2.5.3), then says where it goes. */}
                    {current && <span className="sr-only">, settings</span>}
                  </>
                );
                const className =
                  "flex min-w-0 max-w-[45%] shrink-0 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";
                return current ? (
                  <Link
                    to="/bots/$botId/settings"
                    params={{ botId: current.id }}
                    // Plain words only: harness and model stay in the bot's settings (DESIGN.md "Don't").
                    title={[
                      current.kind === "chief" ? "Your chief" : "Specialist",
                      current.description,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    className={className}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className={className}>{content}</div>
                );
              })()}
              {botId && (
                <>
                  <CaretRightIcon
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                  <ThreadTabs
                    threads={chats.filter(
                      (c) => c.botId === botId && (c.kind ?? "chat") === "chat",
                    )}
                    botId={botId}
                    chatId={chatId}
                    onOpen={openChat}
                    onNew={() => toDraft(botId)}
                    onUpdate={updateThread}
                    onDelete={deleteThread}
                  />
                </>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {current?.computerMode === "desktop" && (
                  <DesktopButton botName={current.name} onError={fail} />
                )}
                {chatId && saved.length > 0 && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Publish snapshot to team"
                    onClick={() => setPublishing(true)}
                    aria-label="Publish snapshot to team"
                  >
                    <ShareNetworkIcon />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Details"
                  aria-label="Details"
                  aria-pressed={details && !thread && !search.artifact}
                  onClick={() => {
                    const other = thread || search.artifact;
                    if (search.artifact) setArtifact(undefined);
                    else if (thread) setThread(undefined);
                    setDetails((d) => !(d && !other));
                  }}
                >
                  <SidebarSimpleIcon className="-scale-x-100" />
                </Button>
              </div>
            </header>
            {undoDelete && (
              <div
                role="status"
                className="flex items-center gap-2 border-b bg-muted px-3 py-1.5 text-xs"
              >
                <span className="truncate">Deleted “{undoDelete.title}”</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={undoDeleteThread}>
                  Undo
                </Button>
              </div>
            )}
            <SetupActionsContext.Provider value={setupActions}>
              <MessageList
                key={chatId ?? `new:${botId}`}
                followToken={sent}
                rows={rows}
                bots={bots}
                authorOf={authorOf}
                fallbackBotId={botId}
                busy={main.busy || loadingMessages}
                label="Conversation"
                actions={actions}
                intro={
                  <>
                    {loadingMessages && saved.length === 0 && (
                      <div
                        className="space-y-5 px-4 py-4"
                        role="status"
                        aria-label="Loading messages"
                      >
                        {["66%", "45%", "75%"].map((w, i) => (
                          <div key={i} className="flex gap-2">
                            <Skeleton className="size-9 rounded-lg" />
                            <div className="flex-1 space-y-2">
                              <Skeleton className="h-3 w-24 rounded" />
                              <Skeleton
                                className="h-4 rounded"
                                style={{ display: "block", inlineSize: w }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!loadingMessages && rows.length === 0 && current && (
                      <div className="mt-auto space-y-3 px-4 pt-10 pb-4">
                        <BotAvatar bot={current} size={64} square />
                        <h3 className="font-heading text-3xl font-medium tracking-tight text-balance">
                          <ChannelIcon
                            aria-hidden="true"
                            className="mr-1 inline size-5 align-baseline text-muted-foreground"
                          />
                          {current.name}
                        </h3>
                        <p className="max-w-prose text-muted-foreground">
                          This is the very beginning of your conversation with{" "}
                          <strong className="text-foreground">{current.name}</strong>.{" "}
                          {current.description}
                        </p>
                        <div
                          className="flex flex-wrap gap-2"
                          role="group"
                          aria-label="Suggested prompts"
                        >
                          {SUGGESTIONS.map((q) => (
                            <Button
                              key={q}
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                              onClick={() =>
                                void send({ text: q, attachmentIds: [], fileRefs: [] })
                              }
                            >
                              {q}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                }
                footer={
                  main.summary && !main.busy ? (
                    <p
                      className="px-4 pt-1 pl-15 text-xs text-muted-foreground"
                      aria-label="Delegation summary"
                    >
                      {main.summary}
                    </p>
                  ) : null
                }
              />
            </SetupActionsContext.Provider>
            <div className="w-full shrink-0 space-y-2 px-4 pb-4">
              <ProposalsPanel
                proposals={proposals}
                bots={bots}
                notify={setNotice}
                onResolved={(id) => setProposals((l) => l.filter((x) => x.id !== id))}
                onBotsChanged={() => void refreshBots()}
              />
              {notice && (
                <Alert theme="info" onClose={() => setNotice(undefined)}>
                  {notice}
                </Alert>
              )}
              {(error || main.error) && (
                <Alert
                  theme="danger"
                  onClose={() => {
                    setError(undefined);
                    main.clearError();
                  }}
                >
                  <p className="break-words">{error ?? errorMessage(main.error)}</p>
                </Alert>
              )}
              <LoopBanner loop={goal.loop} onChange={goal.update} onError={setError} />
              {botId && <ComputerActivity botId={botId} botName={current?.name} />}
              <DraftComposer
                wiki
                storageKey={draftKey(botId, chatId)}
                handle={draft}
                placeholder={
                  main.busy
                    ? "Queue a follow-up…"
                    : current
                      ? `Message ${current.visibility === "private" ? "" : "#"}${current.name}`
                      : "Message your bot"
                }
                bots={bots}
                busy={main.busy}
                disabled={!botId}
                conversationId={chatId}
                onSubmit={send}
                onStop={() => void main.stop()}
                onError={fail}
              />
            </div>
          </section>
          {sidePane && desktop && (
            <aside className="relative hidden min-h-0 border-l lg:flex lg:flex-col">
              {artifactPane && (
                <ResizeHandle
                  edge="left"
                  label="Resize artifact panel"
                  value={artifactWidth}
                  {...ARTIFACT_LIMITS}
                  onChange={(width) => {
                    setArtifactWidth(width);
                    writeArtifactWidth(width);
                  }}
                />
              )}
              {/* DESIGN.md "Motion": panels arrive in 200ms; with reduced motion they just appear. */}
              <motion.div
                key={artifactPane ? "artifact" : threadPane ? "thread" : "details"}
                initial={reduceMotion ? false : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {sidePane}
              </motion.div>
            </aside>
          )}
          {!desktop && (
            <Sheet
              open={!!sidePane}
              onOpenChange={(open) => {
                if (open) return;
                if (search.artifact) setArtifact(undefined);
                else setThread(undefined);
                setDetails(false);
              }}
            >
              <SheetContent
                side="right"
                showCloseButton={false}
                className={cn("w-full p-0", artifactPane ? "sm:max-w-2xl" : "sm:max-w-sm")}
              >
                <SheetTitle className="sr-only">
                  {artifactPane ? "Artifact" : threadPane ? "Thread" : "Details"}
                </SheetTitle>
                {sidePane}
              </SheetContent>
            </Sheet>
          )}
          {publishing && chatId && (
            <PublishDialog
              conversationId={chatId}
              onClose={() => setPublishing(false)}
              onPublished={() => {
                setPublishing(false);
                setNotice(
                  "Published a read-only copy for your team. Later messages are not included.",
                );
              }}
            />
          )}
        </div>
      </LatestChatsContext.Provider>
    </BotsContext.Provider>
  );
}

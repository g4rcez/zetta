import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type RefObject,
} from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ComputerActivity } from "../computer/computer-activity";
import { DesktopButton } from "../computer/desktop-button";
import "../code/register";
import "../computer/register";
import "../plugins/register";
import "../discussions/register";
import "../inbound/register";
import {
  CaretDownIcon,
  HashIcon,
  LockIcon,
  ListIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react";
import { ThreadTabs } from "./thread-tabs";
import { Skeleton } from "@g4rcez/components";

import { Button } from "@zetta/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@zetta/ui/components/sheet";
import { cn } from "@zetta/ui/lib/utils";
import { BotAvatar } from "@/components/bot-avatar";
import { authClient } from "@/lib/auth-client";

import { refreshAttention } from "../attention/summary";
import { BotSettingsDrawer } from "./bot-settings";
import {
  chatClient,
  errorMessage,
  type Bot,
  type Conversation,
  type Message,
  type Proposal,
  type Workspace,
} from "./chat-client";
import { isSavedUserEcho, type Row } from "./chat-rows";
import { Composer } from "./composer";
import { MessageList, type RowActions } from "./message-list";
import type { Author } from "./message-row";
import { ProposalsPanel } from "./proposals-panel";
import { LoopBanner, useGoalLoop } from "./loop-banner";
import { PublishDialog } from "./publish-dialog";
import { toggleReaction } from "./reactions";
import { ChatSidebar } from "./sidebar";
import { ThreadPanel } from "./thread-panel";
import { draftKey, useDraft } from "./use-draft";
import { useZettaChat } from "./use-zetta-chat";
import { Alert } from "@g4rcez/components/alert";

const SUGGESTIONS = [
  "What can you help me with?",
  "Summarize what you remember about me.",
  "Plan my week.",
];
const wide = (query: string) => (notify: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener("change", notify);
  return () => m.removeEventListener("change", notify);
};
const useMedia = (query: string) =>
  useSyncExternalStore(
    wide(query),
    () => window.matchMedia(query).matches,
    () => true,
  );
// A saved message keeps the same Row object while it is unchanged, so memoized rows skip rendering after a reaction or reload.
const rowCache = new WeakMap<Message, Row>();
const asRow = (m: Message): Row => {
  let row = rowCache.get(m);
  if (!row) {
    row = { ...m, createdAt: m.createdAt ?? new Date(0).toISOString() };
    rowCache.set(m, row);
  }
  return row;
};

/** A callback with a fixed identity that always runs the latest closure: lets memoized children skip renders. */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

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
type ChatSearchState = { thread?: string | undefined; bot?: string | undefined };

export function ChatPage() {
  // The URL owns which chat is open: /chat/<conversationId>, /chat/new?bot=<botId> (empty draft) or a bare /chat (resolved below). Nothing else decides it.
  const search = useSearch({ from: "/_auth/chat/{-$chatId}" });
  const params = useParams({ from: "/_auth/chat/{-$chatId}" });
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [saved, setSaved] = useState<Message[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // phones: the bot list replaces the channel while open
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sent, setSent] = useState(0); // bumps on every send so the list jumps to the newest message
  const desktop = useMedia("(min-width: 1024px)");
  const fail = (e: unknown) => setError(errorMessage(e));
  const threadId = search.thread;
  const urlChat = params.chatId;
  const chatId = urlChat && urlChat !== NEW_CHAT ? urlChat : undefined;
  const openChatRow = chatId ? chats.find((c) => c.id === chatId) : undefined;
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
  const setThread = (id?: string) =>
    void navigate({
      to: ".",
      search: (s: ChatSearchState) => ({ ...s, thread: id }),
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
  useEffect(() => {
    chatClient.workspaces().then(setSpaces).catch(fail);
  }, []);
  useEffect(() => {
    chatClient.bots().then(setBots).catch(fail);
  }, []);
  // Every conversation, for the sidebar's per-bot groups.
  const loadChats = useCallback(
    () =>
      chatClient.conversations().then((all) => {
        setChats(all);
        return all;
      }),
    [],
  );
  useEffect(() => {
    loadChats()
      .then(() => setChatsLoaded(true))
      .catch(fail);
  }, [loadChats]);
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
    if (!urlChat || (chatId && !openChatRow)) {
      const last = !urlChat ? readLastChat() : undefined;
      if (last && chats.some((c) => c.id === last)) toChat(last, true);
      else if (defaultBot) toBot(defaultBot.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsLoaded, bots, urlChat, chatId, openChatRow, defaultBot?.id]);
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
  const main = useZettaChat({
    conversationId: chatId,
    onSettled: settle,
    onProposal: () => void loadProposals(),
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
  const replaceBot = (bot: Bot) =>
    setBots((list) =>
      list.map((b) => (b.id === bot.id ? { ...b, ...bot, canEdit: b.canEdit } : b)),
    );
  const refreshBots = () =>
    chatClient
      .bots()
      .then(setBots)
      .catch(() => {});
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

  // Saved history is rebuilt only when it changes; each streamed chunk just appends the live rows.
  const top = useMemo(() => saved.filter((m) => !m.parentMessageId).map(asRow), [saved]);
  const rows = useMemo(() => {
    const ids = new Set(top.map((x) => x.id));
    const live = main.rows.filter(
      (r) => !r.parentMessageId && !ids.has(r.id) && !isSavedUserEcho(r, top),
    );
    return live.length ? [...top, ...live] : top;
  }, [top, main.rows]);
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
    instructionIds,
  }: {
    text: string;
    attachmentIds: string[];
    fileRefs: string[];
    instructionIds?: string[] | undefined;
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
      void main
        .send(text, { conversationId: id, attachmentIds, fileRefs, instructionIds })
        .catch(fail);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  const hasReply = saved.some((m) => m.role === "assistant" && m.status === "complete");
  async function answer(satisfied: boolean) {
    if (!current || !chatId) return;
    try {
      const q = await chatClient.askOnboarding(current.id, chatId);
      replaceBot(
        await chatClient.answerOnboarding(current.id, {
          conversationId: chatId,
          questionId: q.questionId,
          expectedVersion: current.version,
          satisfied,
        }),
      );
      void reload(chatId);
      setNotice(
        satisfied
          ? "Great, this bot is ready for work."
          : "Okay. Adjust the settings, then chat again to retest.",
      );
    } catch (e) {
      fail(e);
    }
  }
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
    onSaveInstruction: (row) =>
      void chatClient
        .saveInstruction(`From chat: ${row.content.slice(0, 40)}`, row.content)
        .then(() => setNotice("Saved to your instruction library."), fail),
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
      onSaveInstruction: (row) => latestActions.current.onSaveInstruction(row),
      onQueue: (row, action) => latestActions.current.onQueue?.(row, action),
    }),
    [],
  );
  function openChat(id: string) {
    toChat(id);
    setNavOpen(false);
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
  function updateThread(id: string, patch: { title?: string; archived?: boolean }) {
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
  // Stable handlers for the memoized sidebar.
  const onSidebarBot = useEvent((id: string) => {
    toBot(id);
    setNavOpen(false);
  });
  const onSidebarChat = useEvent(openChat);
  const onSidebarUpdateChat = useEvent(
    (id: string, patch: { title?: string; pinned?: boolean; favorite?: boolean }) => {
      const before = chats;
      setChats((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      chatClient.updateConversation(id, patch).then(
        (row) => setChats((all) => all.map((c) => (c.id === id ? { ...c, ...row } : c))),
        (e) => {
          setChats(before);
          fail(e);
        },
      );
    },
  );
  const onSidebarNewChat = useEvent((id: string) => {
    toDraft(id);
    setNavOpen(false);
  });
  const onSidebarNewBot = useEvent(() => void navigate({ to: "/bots/new" }));
  const onSidebarAddSpace = useEvent(
    (name: string, parentId?: string) =>
      void chatClient
        .createWorkspace(name, parentId)
        .then((w) => setSpaces((s) => [...s, w]), fail),
  );
  const ChannelIcon = current?.visibility === "private" ? LockIcon : HashIcon;
  const chatTitle = chats.find((c) => c.id === chatId)?.title;

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

  return (
    <div
      className={cn(
        "grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[20rem_minmax(0,1fr)]",
        threadPane && desktop && "lg:grid-cols-[20rem_minmax(0,1fr)_26rem]",
      )}
    >
      <div className={`${navOpen ? "flex" : "hidden"} min-h-0 md:flex`}>
        <ChatSidebar
          bots={bots}
          spaces={spaces}
          chats={chats}
          botId={botId}
          chatId={chatId}
          onBot={onSidebarBot}
          onChat={onSidebarChat}
          onUpdateChat={onSidebarUpdateChat}
          onNewChat={onSidebarNewChat}
          onNewBot={onSidebarNewBot}
          onAddSpace={onSidebarAddSpace}
        />
      </div>
      <section
        className={`${navOpen ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-col bg-background`}
        aria-label={current ? `Channel ${current.name}` : "Chat"}
      >
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Bots"
            className="md:hidden"
            onClick={() => setNavOpen(true)}
          >
            <ListIcon />
          </Button>
          <button
            type="button"
            disabled={!current}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label={current ? `${current.name} settings` : "Bot settings"}
            title={
              current
                ? [
                    current.kind === "chief" ? "Chief" : "Specialist",
                    current.harness === "fixture"
                      ? "offline test"
                      : `${current.harness}${current.model ? ` · ${current.model}` : ""}`,
                    current.description,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : undefined
            }
            className="flex min-w-0 max-w-[60%] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {current ? (
              <BotAvatar bot={current} size={24} square />
            ) : (
              <ChannelIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            )}
            <h2 className="truncate font-heading text-base font-medium leading-tight">
              {current?.name ?? "Chat"}
            </h2>
            {current && (
              <ChannelIcon
                aria-label={current.visibility === "private" ? "Private" : "Team"}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            )}
            <CaretDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {current?.computerMode === "desktop" && (
              <DesktopButton botName={current.name} onError={fail} />
            )}
            {chatTitle && (
              <span
                className="hidden min-w-0 max-w-48 truncate px-2 text-xs text-muted-foreground xl:inline"
                title={chatTitle}
              >
                {chatTitle}
              </span>
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
          </div>
        </header>
        {botId && (
          <ThreadTabs
            threads={chats.filter((c) => c.botId === botId && (c.kind ?? "chat") === "chat")}
            botId={botId}
            chatId={chatId}
            onOpen={openChat}
            onNew={() => toDraft(botId)}
            onUpdate={updateThread}
            onDelete={deleteThread}
          />
        )}
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
        <MessageList
          key={chatId ?? `new:${botId}`}
          followToken={sent}
          rows={rows}
          authorOf={authorOf}
          fallbackBotId={botId}
          busy={main.busy || loadingMessages}
          label="Conversation"
          actions={actions}
          intro={
            <>
              {loadingMessages && saved.length === 0 && (
                <div className="space-y-5 px-4 py-4" role="status" aria-label="Loading messages">
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
                  {current.canEdit && !current.onboarded && (
                    <p className="max-w-prose text-sm text-muted-foreground">
                      {current.name} isn't ready yet: send a test message to start setup.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested prompts">
                    {SUGGESTIONS.map((q) => (
                      <Button
                        key={q}
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => void send({ text: q, attachmentIds: [], fileRefs: [] })}
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
        <div className="shrink-0 space-y-2 px-4 pb-4">
          <ProposalsPanel
            proposals={proposals}
            bots={bots}
            notify={setNotice}
            onResolved={(id) => setProposals((l) => l.filter((x) => x.id !== id))}
            onBotsChanged={() => void refreshBots()}
          />
          {current && current.canEdit && !current.onboarded && hasReply && (
            <div
              role="group"
              aria-label="Onboarding"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
            >
              <p>Are you satisfied with how {current.name} answers?</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void answer(true)}>
                  Yes, I'm satisfied
                </Button>
                <Button size="sm" variant="outline" onClick={() => void answer(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          )}
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
            instructions
            storageKey={draftKey(botId, chatId)}
            handle={draft}
            placeholder={
              current
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
      {threadPane && desktop && (
        <aside className="hidden min-h-0 border-l lg:flex lg:flex-col">{threadPane}</aside>
      )}
      {!desktop && (
        <Sheet
          open={!!threadPane}
          onOpenChange={(open) => {
            if (!open) setThread(undefined);
          }}
        >
          <SheetContent side="right" showCloseButton={false} className="w-full p-0 sm:max-w-md">
            <SheetTitle className="sr-only">Thread</SheetTitle>
            {threadPane}
          </SheetContent>
        </Sheet>
      )}
      {current && (
        <BotSettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          bot={current}
          bots={bots}
          spaces={spaces}
          onBotChange={replaceBot}
          notify={setNotice}
        />
      )}
      {publishing && chatId && (
        <PublishDialog
          conversationId={chatId}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false);
            setNotice("Published a read-only copy for your team. Later messages are not included.");
          }}
        />
      )}
    </div>
  );
}

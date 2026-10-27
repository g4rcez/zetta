import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ComputerActivity } from "../computer/computer-activity";
import { DesktopButton } from "../computer/desktop-button";
import "../code/register";
import "../computer/register";
import "../plugins/register";
import "../discussions/register";
import "../inbound/register";
import { ChevronDown, Hash, Lock, Menu, Share2 } from "lucide-react";
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
import type { Row } from "./chat-rows";
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
const asRow = (m: Message): Row => ({ ...m, createdAt: m.createdAt ?? new Date(0).toISOString() });

const NEW_CHAT = "new";
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
  const composer = useDraft(draftKey(botId, chatId));

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
  useEffect(() => {
    void loadProposals();
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
  // A bare /chat has no state of its own: it becomes the default bot's latest conversation. A chat that no longer exists falls back the same way.
  useEffect(() => {
    if (!chatsLoaded || !bots.length) return;
    if (!urlChat || (chatId && !openChatRow)) {
      if (defaultBot) toBot(defaultBot.id, true);
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
      void refreshAttention();
    },
    [reload, loadChats],
  );
  const main = useZettaChat({
    conversationId: chatId,
    onSettled: settle,
    onProposal: () => void loadProposals(),
  });
  // A running goal loop starts each step on the server: follow it live, and reload when it moves on.
  const goal = useGoalLoop(
    chatId,
    () => main.reattach(),
    () => {
      if (chatId) void reload(chatId);
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
  const me: Author = { name: session?.user.name ?? "You", image: session?.user.image };
  const authorOf = useCallback(
    (row: Row): Author => {
      // Outside people writing through a channel plugin are not the signed-in user.
      if (row.role === "user" && row.meta?.inbound)
        return { name: `${row.meta.inbound.label} · ${row.meta.inbound.chatName}` };
      if (row.role === "user") return me;
      const bot = bots.find((b) => b.id === (row.botId ?? botId));
      return { name: bot?.name ?? row.botName ?? "Bot", bot };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [bots, botId, me.name, me.image],
  );

  const rows = useMemo(() => {
    const top = saved.filter((m) => !m.parentMessageId).map(asRow);
    return [
      ...top,
      ...main.rows.filter((r) => !r.parentMessageId && !top.some((x) => x.id === r.id)),
    ];
  }, [saved, main.rows]);
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
  }: {
    text: string;
    attachmentIds: string[];
    fileRefs: string[];
  }) {
    if (!botId) return false;
    setError(undefined);
    try {
      let id = chatId;
      if (!id) {
        composer.adopt();
        const created = await chatClient.startConversation(botId);
        id = created.id;
        setChats((c) => [created, ...c]);
        toChat(id, true);
      }
      composer.clear();
      setSent((n) => n + 1);
      void main.send(text, { conversationId: id, attachmentIds, fileRefs });
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
  const actions: RowActions = {
    onReact: (row, emoji) => void toggleReact(row, emoji),
    onReply: (row) => setThread(row.id),
    onSaveInstruction: (row) =>
      void chatClient
        .saveInstruction(`From chat: ${row.content.slice(0, 40)}`, row.content)
        .then(() => setNotice("Saved to your instruction library."), fail),
  };
  function openChat(id: string) {
    toChat(id);
    setNavOpen(false);
  }
  const ChannelIcon = current?.visibility === "private" ? Lock : Hash;
  const chatTitle = chats.find((c) => c.id === chatId)?.title;

  const threadPane =
    thread && chatId ? (
      <ThreadPanel
        key={thread.id}
        conversationId={chatId}
        parent={thread}
        replies={replies}
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
          onBot={(id) => {
            toBot(id);
            setNavOpen(false);
          }}
          onChat={openChat}
          onUpdateChat={(id, patch) => {
            const before = chats;
            setChats((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
            chatClient.updateConversation(id, patch).then(
              (row) => setChats((all) => all.map((c) => (c.id === id ? { ...c, ...row } : c))),
              (e) => {
                setChats(before);
                fail(e);
              },
            );
          }}
          onNewChat={(id) => {
            toDraft(id);
            setNavOpen(false);
          }}
          onNewBot={() => void navigate({ to: "/bots/new" })}
          onAddSpace={(name, parentId) =>
            void chatClient
              .createWorkspace(name, parentId)
              .then((w) => setSpaces((s) => [...s, w]), fail)
          }
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
            className="md:hidden"
            aria-label="Bots"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </Button>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
            aria-label={current ? `${current.name} settings` : "Bot settings"}
            disabled={!current}
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
            <h2 className="truncate text-sm font-semibold leading-tight">
              {current?.name ?? "Chat"}
            </h2>
            {current && (
              <ChannelIcon
                aria-label={current.visibility === "private" ? "Private" : "Team"}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            )}
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
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
                aria-label="Publish snapshot to team"
                title="Publish snapshot to team"
                onClick={() => setPublishing(true)}
              >
                <Share2 />
              </Button>
            )}
          </div>
        </header>
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
                  <h3 className="text-2xl font-bold">
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
          <Composer
            value={composer.value}
            onChange={composer.set}
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

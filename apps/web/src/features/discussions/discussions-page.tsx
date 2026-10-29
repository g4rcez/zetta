import { Link, useNavigate } from "@tanstack/react-router";
import { MessagesSquare, Network, Plus, Repeat, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@zetta/ui/components/badge";
import { cn } from "@zetta/ui/lib/utils";
import { Button, Checkbox, Input, Textarea } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import {
  chatClient,
  errorMessage,
  type Bot,
  type Message,
  type Proposal,
} from "../chat/chat-client";
import type { Row } from "../chat/chat-rows";
import { Composer, type Outgoing } from "../chat/composer";
import { LoopBanner, useGoalLoop } from "../chat/loop-banner";
import { BotAvatar } from "@/components/bot-avatar";
import { BotIdentity } from "@/components/bot-identity";
import { Drawer } from "@/components/drawer";
import { ComputerActivity } from "../computer/computer-activity";
import { MessageList } from "../chat/message-list";
import { useZettaChat } from "../chat/use-zetta-chat";
import type { Author } from "../chat/message-row";
import { ProposalsPanel } from "../chat/proposals-panel";
import {
  discussionsApi,
  STATUS_LABEL,
  type DiscussionDetail,
  type DiscussionListItem,
  type DiscussionStatus,
  type RoomTask,
  type RoomTurn,
} from "./discussions-api";
import { RoomCanvas } from "./room-canvas";
import { StepsDrawer } from "./steps-drawer";
import { Alert } from "@g4rcez/components/alert";

const STATUS_CLASS: Record<DiscussionStatus, string> = {
  open: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  paused: "bg-muted text-muted-foreground",
  stalled: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1
    ? "now"
    : m < 60
      ? `${m}m`
      : m < 1440
        ? `${Math.round(m / 60)}h`
        : `${Math.round(m / 1440)}d`;
};
const closed = (s: DiscussionStatus) => s === "resolved" || s === "cancelled";

/** Group discussions between bots: the list, one discussion's shared context and transcript, and a form to start one yourself. */
export function DiscussionsPage({
  selectedId,
  view = "chat",
}: {
  selectedId?: string | undefined;
  view?: "chat" | "canvas";
}) {
  const navigate = useNavigate();
  const [list, setList] = useState<DiscussionListItem[]>();
  const [bots, setBots] = useState<Bot[]>([]);
  const [creating, setCreating] = useState(false);
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);
  const reloadList = useCallback(
    () =>
      discussionsApi.list().then(setList, (e) => {
        setList((x) => x ?? []);
        fail(e);
      }),
    [fail],
  );
  useEffect(() => {
    void reloadList();
    chatClient.bots().then(setBots, fail);
  }, [reloadList, fail]);
  const live = list?.some((d) => d.running || d.queued > 0);
  // Bots work in the background: refresh often while one is working, slowly otherwise.
  useEffect(() => {
    const t = setInterval(
      () => {
        if (document.visibilityState === "visible") void reloadList();
      },
      live ? 3000 : 15_000,
    );
    return () => clearInterval(t);
  }, [live, reloadList]);
  const select = (id?: string) => {
    setCreating(false);
    void navigate({ to: "/discussions", search: id ? { id } : {} });
  };

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[20rem_minmax(0,1fr)]">
      <aside
        aria-label="Discussions"
        className={cn(
          "flex min-h-0 flex-col border-r bg-sidebar",
          (selectedId || creating) && "hidden md:flex",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <h1 className="text-base font-semibold">Discussions</h1>
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
              void navigate({ to: "/discussions", search: {} });
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {!list && (
            <li role="status" className="p-2 text-sm text-muted-foreground">
              Loading…
            </li>
          )}
          {list?.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              No discussions yet. Bots open one when a task needs other bots, or start one yourself.
            </li>
          )}
          {list?.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => select(d.id)}
                aria-current={d.id === selectedId ? "true" : undefined}
                className={cn(
                  "w-full space-y-1 rounded-md p-2 text-left text-sm hover:bg-sidebar-accent",
                  d.id === selectedId && "bg-sidebar-accent",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{d.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(d.updatedAt)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span className={cn("rounded px-1.5 py-0.5 font-medium", STATUS_CLASS[d.status])}>
                    {d.awaitingApproval
                      ? "Waiting for you"
                      : d.running
                        ? "Bot working…"
                        : STATUS_LABEL[d.status]}
                  </span>
                  <span className="flex min-w-0 items-center gap-1">
                    {d.members.map((m) => (
                      <span key={m.botId} title={m.name} className="shrink-0">
                        <BotAvatar
                          bot={bots.find((b) => b.id === m.botId) ?? { id: m.botId }}
                          size={18}
                        />
                      </span>
                    ))}
                    <span className="min-w-0 truncate">
                      {d.members.map((m) => m.name).join(", ")}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">
        {creating ? (
          <NewDiscussion
            bots={bots}
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              void reloadList();
              select(id);
            }}
          />
        ) : selectedId ? (
          <DiscussionView
            key={selectedId}
            id={selectedId}
            view={view}
            onView={(v) =>
              void navigate({
                to: "/discussions",
                search: v === "canvas" ? { id: selectedId, view: v } : { id: selectedId },
              })
            }
            bots={bots}
            onBack={() => select()}
            onChanged={() => void reloadList()}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">
            <div className="space-y-2">
              <UsersRound className="mx-auto size-8" aria-hidden="true" />
              <p>Pick a discussion to follow what the bots are doing.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function DiscussionView({
  id,
  view,
  onView,
  bots,
  onBack,
  onChanged,
}: {
  id: string;
  view: "chat" | "canvas";
  onView: (v: "chat" | "canvas") => void;
  bots: Bot[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const { data: session } = authClient.useSession();
  const [detail, setDetail] = useState<DiscussionDetail>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [briefs, setBriefs] = useState<Proposal[]>([]);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<{ turns: RoomTurn[]; tasks: RoomTask[] }>({
    turns: [],
    tasks: [],
  });
  const [openBot, setOpenBot] = useState<string>();
  const [loopForm, setLoopForm] = useState<{ goal: string; doneWhen: string }>();
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);
  const load = useCallback(async () => {
    try {
      const d = await discussionsApi.get(id);
      setDetail(d);
      if (d.discussion.teamId && view === "canvas") setRoom(await discussionsApi.steps(id));
      setMessages(await chatClient.messages(d.discussion.conversationId));
      const memberIds = new Set(d.members.map((m) => m.botId));
      // Same panel as a chat: the briefs that gate this discussion and whatever its bots proposed (config changes, and so on).
      setBriefs(
        (await chatClient.proposals()).filter((p) =>
          p.kind === "discussion_brief"
            ? p.patch?.discussionId === id
            : p.kind !== "open_discussion" && Boolean(p.botId && memberIds.has(p.botId)),
        ),
      );
    } catch (e) {
      fail(e);
    }
  }, [id, view, fail]);
  useEffect(() => {
    void load();
  }, [load]);
  // The room's goal loop: each step wakes the facilitator and the members discuss it; the room polling above shows the result.
  const goalLoop = useGoalLoop(
    detail?.discussion.conversationId,
    () => {},
    () => void load(),
  );
  const working = detail?.turns.some((t) => t.status === "running" || t.status === "queued");
  useEffect(() => {
    const t = setInterval(
      () => {
        if (document.visibilityState === "visible") void load();
      },
      working ? 2000 : 10_000,
    );
    return () => clearInterval(t);
  }, [working, load]);

  const runningTurn = detail?.turns.find((t) => t.status === "running");
  // The turn that is running streams here live, exactly like a chat reply, and the page reloads when it settles.
  const liveChat = useZettaChat({
    conversationId: detail?.discussion.conversationId,
    attachKey: runningTurn?.id,
    onSettled: async () => {
      await load();
      onChanged();
    },
    onProposal: () => void load(),
  });
  const me: Author = { name: session?.user.name ?? "You", image: session?.user.image };
  const authorOf = useCallback(
    (row: Row): Author => {
      if (row.role === "user") return me;
      if (row.role === "system") return { name: "Zetta" };
      const bot = bots.find((b) => b.id === row.botId);
      return { name: bot?.name ?? row.botName ?? "Bot", bot };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [bots, session?.user.name, session?.user.image],
  );
  const rows = useMemo<Row[]>(() => {
    const saved = messages.map((m) => ({
      ...m,
      createdAt: m.createdAt ?? new Date().toISOString(),
      streaming: m.status === "running",
    }));
    const known = new Set(saved.filter((r) => r.status !== "running").map((r) => r.id));
    const streaming = new Set(liveChat.rows.map((r) => r.id));
    return [
      ...saved.filter((r) => r.status !== "running" || !streaming.has(r.id)),
      ...liveChat.rows.filter((r) => !known.has(r.id)),
    ];
  }, [messages, liveChat.rows]);

  async function act(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await work();
      if (done) toast.success(done);
      await load();
      onChanged();
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  }
  async function send(out: Outgoing) {
    setBusy(true);
    try {
      await discussionsApi.post(id, out.text, out);
      setDraft("");
      await load();
      onChanged();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!detail)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  const d = detail.discussion,
    isClosed = closed(d.status);
  const running = detail.turns.find((t) => t.status === "running");
  const names = new Map(detail.members.map((m) => [m.botId, m.name]));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <section aria-label="Transcript" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Button size="sm" variant="ghost" className="md:hidden" onClick={onBack}>
            Back
          </Button>
          <h2 className="mr-auto truncate text-base font-semibold">{d.title}</h2>
          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_CLASS[d.status])}>
            {STATUS_LABEL[d.status]}
          </span>
          <span className="text-xs text-muted-foreground" title="Bot turns used of the budget">
            {d.turnsUsed}/{d.turnBudget} turns
          </span>
          {d.teamId && (
            <div
              role="group"
              aria-label="Room view"
              className="flex overflow-hidden rounded-md border"
            >
              <Button
                size="sm"
                variant={view === "chat" ? "default" : "ghost"}
                aria-pressed={view === "chat"}
                onClick={() => onView("chat")}
              >
                <MessagesSquare className="size-4" aria-hidden="true" /> Chat
              </Button>
              <Button
                size="sm"
                variant={view === "canvas" ? "default" : "ghost"}
                aria-pressed={view === "canvas"}
                onClick={() => onView("canvas")}
              >
                <Network className="size-4" aria-hidden="true" /> Canvas
              </Button>
            </div>
          )}
          {!isClosed &&
            d.createdByBotId &&
            detail.members.length > 1 &&
            (!goalLoop.loop ||
              (goalLoop.loop.status !== "running" && goalLoop.loop.status !== "paused")) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setLoopForm({ goal: d.goal, doneWhen: "" })}
              >
                <Repeat className="size-4" aria-hidden="true" /> Pursue goal
              </Button>
            )}
          {!isClosed &&
            (d.status === "open" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => discussionsApi.act(id, "pause"))}
              >
                Pause
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => discussionsApi.act(id, "resume"))}
              >
                Resume
              </Button>
            ))}
          {!isClosed && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const summary = window.prompt("What was the outcome?");
                if (summary?.trim())
                  void act(() => discussionsApi.resolve(id, summary.trim()), "Resolved.");
              }}
            >
              Resolve
            </Button>
          )}
          {!isClosed && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel this discussion? Queued bot turns are dropped."))
                  void act(() => discussionsApi.act(id, "cancel"));
              }}
            >
              Cancel
            </Button>
          )}
        </header>
        <LoopBanner
          loop={goalLoop.loop}
          onChange={goalLoop.update}
          onError={(m) => toast.error(m)}
        />
        {loopForm && (
          <Drawer
            open
            onClose={() => setLoopForm(undefined)}
            title="Pursue a goal"
            description="The team keeps discussing and working, step after step, until the goal is met. You can stop it at any time."
          >
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => discussionsApi.startLoop(id, loopForm), "The team is on it.").then(
                  () => setLoopForm(undefined),
                );
              }}
            >
              <Textarea
                title="Goal"
                rows={3}
                maxLength={500}
                value={loopForm.goal}
                onChange={(e) => setLoopForm({ ...loopForm, goal: e.target.value })}
              />
              <Input
                title="Done when"
                maxLength={300}
                placeholder="How the team will know it is finished"
                value={loopForm.doneWhen}
                onChange={(e) => setLoopForm({ ...loopForm, doneWhen: e.target.value })}
              />
              <Button
                type="submit"
                disabled={busy || !loopForm.goal.trim() || !loopForm.doneWhen.trim()}
              >
                Start the loop
              </Button>
            </form>
          </Drawer>
        )}
        {d.teamId && view === "canvas" ? (
          <>
            <RoomCanvas
              bots={bots}
              members={detail.members}
              chiefId={d.createdByBotId}
              turns={room.turns}
              tasks={room.tasks}
              onOpen={setOpenBot}
            />
            {openBot && (
              <StepsDrawer
                bot={
                  bots.find((b) => b.id === openBot) ?? {
                    id: openBot,
                    name: names.get(openBot) ?? "Bot",
                  }
                }
                role={detail.members.find((m) => m.botId === openBot)?.role ?? ""}
                turns={room.turns.filter((t) => t.botId === openBot)}
                tasks={room.tasks.filter((t) => t.botId === openBot)}
                onClose={() => setOpenBot(undefined)}
              />
            )}
          </>
        ) : (
          <>
            <MessageList
              key={d.conversationId}
              rows={rows}
              authorOf={authorOf}
              busy={Boolean(working) || liveChat.busy}
              label="Discussion transcript"
              threads={false}
              actions={{
                onReact: (row, emoji) => void chatClient.react(row.id, emoji).then(load, fail),
                onReply: () => {},
                onSaveInstruction: (row) =>
                  void chatClient
                    .saveInstruction(d.title, row.content)
                    .then(() => toast.success("Saved as an instruction."), fail),
              }}
              intro={
                rows.length === 0 ? (
                  <p role="status" className="px-4 py-6 text-sm text-muted-foreground">
                    No messages yet.
                  </p>
                ) : null
              }
              footer={
                running && !liveChat.busy ? (
                  <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
                    {names.get(running.botId) ?? "A bot"} is working…
                  </p>
                ) : null
              }
            />
            <div className="shrink-0 space-y-2 px-4 pb-4">
              {briefs.length > 0 && (
                <ProposalsPanel
                  proposals={briefs}
                  bots={bots}
                  notify={(m) => toast(m)}
                  onResolved={() => void load()}
                  onBotsChanged={() => void load()}
                />
              )}
              {liveChat.error && (
                <Alert theme="danger" onClose={() => liveChat.clearError()}>
                  <p className="break-words">{errorMessage(liveChat.error)}</p>
                </Alert>
              )}
              {running && (
                <ComputerActivity botId={running.botId} botName={names.get(running.botId)} />
              )}
              {!isClosed && (
                <Composer
                  value={draft}
                  onChange={setDraft}
                  placeholder={`Message the group, e.g. @${detail.members[0]?.name.replace(/\s+/g, "") ?? "Bot"}`}
                  bots={bots.filter((b) => names.has(b.id))}
                  busy={busy}
                  conversationId={d.conversationId}
                  instructions
                  onSubmit={send}
                  onError={fail}
                />
              )}
            </div>
          </>
        )}
      </section>
      <aside
        aria-label="Task context"
        className="max-h-[45%] min-w-0 shrink-0 space-y-4 overflow-x-hidden overflow-y-auto border-t p-4 text-sm break-words lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
      >
        {d.tainted && (
          <Alert theme="warn">
            This discussion includes outside content
            {d.originInbound ? ` (from ${d.originInbound.chatName})` : ""}. Bots that can change
            code wait for you to approve the brief.
          </Alert>
        )}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Goal</h3>
          <p className="whitespace-pre-wrap">{d.goal || "(not set)"}</p>
        </div>
        {d.summary && (
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Outcome</h3>
            <p className="whitespace-pre-wrap">{d.summary}</p>
          </div>
        )}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Shared context <span className="font-normal normal-case">v{d.contextVersion}</span>
          </h3>
          {context === undefined ? (
            <>
              <p className="whitespace-pre-wrap break-words">{d.context || "(empty)"}</p>
              {!isClosed && (
                <Button size="sm" variant="outline" onClick={() => setContext(d.context)}>
                  Edit
                </Button>
              )}
            </>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await discussionsApi.update(id, d.version, { context });
                  setContext(undefined);
                }, "Context saved.");
              }}
            >
              <Textarea
                title="Shared context"
                hiddenLabel
                rows={8}
                value={context}
                maxLength={8000}
                onChange={(e) => setContext(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Changing it asks again before a code bot acts on outside content.
              </p>
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={busy}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => setContext(undefined)}
                >
                  Discard
                </Button>
              </div>
            </form>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Bots</h3>
          <ul className="space-y-2">
            {detail.members.map((m) => (
              <li key={m.botId} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  {m.botId === d.createdByBotId && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      Facilitator
                    </Badge>
                  )}
                  {m.code && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      Code
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">{m.turns} turns</span>
                </div>
                {m.role && <p className="text-xs text-muted-foreground">{m.role}</p>}
                {m.code && d.tainted && (
                  <Checkbox
                    checked={m.requireApproval}
                    disabled={busy || isClosed}
                    onChange={(e) =>
                      void act(() => discussionsApi.setApproval(id, m.botId, e.target.checked))
                    }
                  >
                    Ask me before it acts
                  </Checkbox>
                )}
              </li>
            ))}
          </ul>
        </div>
        {d.originConversationId && (
          <Link
            className="block text-xs text-primary hover:underline"
            to="/chat/{-$chatId}"
            params={{ chatId: d.originConversationId }}
          >
            Open the chat that started it
          </Link>
        )}
      </aside>
    </div>
  );
}

function NewDiscussion({
  bots,
  onCancel,
  onCreated,
}: {
  bots: Bot[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const ready = bots.filter((b) => b.onboarded);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    setBusy(true);
    try {
      const d = await discussionsApi.create({
        title: String(f.get("title") ?? ""),
        goal: String(f.get("goal") ?? ""),
        context: String(f.get("context") ?? ""),
        members: picked.map((bot) => ({ bot })),
        firstMessage: String(f.get("first") ?? ""),
      });
      onCreated(d.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <form
      className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-4 md:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">New discussion</h2>
        <p className="text-sm text-muted-foreground">
          Bring bots together on one task. They see the goal and the shared context, hand work to
          each other with @mentions, and resolve it when done.
        </p>
      </div>
      <Input
        title="Title"
        name="title"
        required
        maxLength={120}
        placeholder="e.g. Login crash reported by a customer"
        autoFocus
      />
      <Textarea
        title="Goal"
        name="goal"
        required={false}
        rows={2}
        maxLength={1000}
        placeholder="What done looks like"
      />
      <Textarea
        title="Shared context"
        name="context"
        required={false}
        rows={5}
        maxLength={8000}
        placeholder="Everything the bots need: who asked, what happened, links, ids"
      />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Bots (up to 5)</legend>
        {ready.length === 0 ? (
          <p className="text-xs text-muted-foreground">No ready bots yet.</p>
        ) : (
          ready.map((b) => (
            <Checkbox
              key={b.id}
              checked={picked.includes(b.id)}
              disabled={!picked.includes(b.id) && picked.length >= 5}
              onChange={(e) =>
                setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))
              }
            >
              <BotIdentity bot={b} size={24} sub={b.description} />
            </Checkbox>
          ))
        )}
      </fieldset>
      <Textarea
        title="First message"
        name="first"
        required
        rows={3}
        maxLength={4000}
        placeholder="Mention who should start, e.g. @Dev please look at the crash. Without a mention, every bot answers once."
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || picked.length === 0}>
          Start discussion
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

import { Link, useNavigate } from "@tanstack/react-router";
import {
  CaretDownIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  HashIcon,
  InfoIcon,
  LifebuoyIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  SpeakerSlashIcon,
  StopCircleIcon,
  TargetIcon,
  TrashIcon,
  UsersIcon,
  UsersThreeIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@zetta/ui/components/badge";
import { Button as IconButton } from "@zetta/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { cn } from "@zetta/ui/lib/utils";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import {
  chatClient,
  errorMessage,
  type Bot,
  type Message,
  type Proposal,
} from "../chat/chat-client";
import { transcriptRows, type Row } from "../chat/chat-rows";
import type { Outgoing } from "../chat/composer";
import { DraftComposer, type DraftHandle } from "../chat/draft-composer";
import { draftKey } from "../chat/use-draft";
import { LoopBanner, useGoalLoop } from "../chat/loop-banner";
import { useRooms, useSidebarData } from "../chat/sidebar-data";
import { BotAvatar } from "@/components/bot-avatar";
import { Drawer } from "@/components/drawer";
import { ComputerActivity } from "../computer/computer-activity";
import { refreshAttention } from "../attention/summary";
import { MentionTextarea, mentionedBots, withoutMention } from "../chat/mention";
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
  type RoomKind,
  type RoomTask,
  type RoomTurn,
} from "./discussions-api";
import { teamsApi, type Team } from "../teams/teams-api";
import { roomLabel, roomStatus } from "./rooms";
import { RoomCanvas } from "./room-canvas";
import { StepsDrawer } from "./steps-drawer";
import { Alert } from "@g4rcez/components/alert";

const STATUS_CLASS: Record<DiscussionStatus, string> = {
  open: "bg-info/15 text-info",
  paused: "bg-muted text-muted-foreground",
  stalled: "bg-warn/15 text-warn",
  resolved: "bg-success/15 text-success",
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
const botOf = (bots: Bot[], id: string) => bots.find((b) => b.id === id) ?? { id };

/** `#` is a room; the Chief's help and permission rooms get their own mark. */
function KindIcon({ kind, className }: { kind: RoomKind; className?: string }) {
  const Icon = kind === "help" ? LifebuoyIcon : kind === "permissions" ? LockKeyIcon : HashIcon;
  return (
    <Icon aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground", className)} />
  );
}

/** The 48px bar every room page shares. */
function PageHeader({
  title,
  icon,
  team,
  children,
}: {
  title: string;
  icon: ReactNode;
  /** A team room: the title becomes the link to the team settings page, like a bot's header. */
  team?: { teamId: string; roomId: string };
  children?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      {team ? (
        <Link
          to="/teams/$teamId/settings"
          params={{ teamId: team.teamId }}
          search={{ room: team.roomId }}
          aria-label={`${title} settings`}
          className="flex min-w-0 max-w-[60%] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          {icon}
          <h2 className="truncate font-heading text-base font-medium leading-tight">{title}</h2>
          <UsersIcon aria-label="Team" className="size-3.5 shrink-0 text-muted-foreground" />
          <CaretDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </Link>
      ) : (
        <>
          {icon}
          <h2 className="truncate font-heading text-base font-medium leading-tight">{title}</h2>
        </>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1">{children}</div>
    </header>
  );
}

const DETAILS_KEY = "zetta.room-details";
/** Whether the details panel is open: the user's last choice, else open on wide screens. */
function useDetailsPanel() {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(DETAILS_KEY);
      if (saved) return saved === "open";
    } catch {
      // Storage unavailable (private mode): fall through to the screen size.
    }
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const set = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(DETAILS_KEY, next ? "open" : "closed");
    } catch {
      // Storage unavailable (private mode): the choice lasts for this session.
    }
  };
  return [open, set] as const;
}

/**
 * Rooms, where bots work a task together. The sidebar is the same one the chat page uses, so a room is one click from any bot;
 * the main area is the room's transcript with its details beside it, a list of rooms, or the form for a new one.
 */
export function RoomsPage({
  selectedId,
  view = "chat",
  creating = false,
}: {
  selectedId?: string | undefined;
  view?: "chat" | "canvas";
  creating?: boolean;
}) {
  const navigate = useNavigate();
  const { bots } = useSidebarData();
  const { reload } = useRooms();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {creating ? (
          <NewRoom
            bots={bots}
            onCancel={() => void navigate({ to: "/rooms", search: {} })}
            onCreated={(id) => {
              void reload();
              void navigate({ to: "/rooms", search: { id } });
            }}
          />
        ) : selectedId ? (
          <RoomView
            key={selectedId}
            id={selectedId}
            view={view}
            onView={(v) =>
              void navigate({
                to: "/rooms",
                search: v === "canvas" ? { id: selectedId, view: v } : { id: selectedId },
              })
            }
            bots={bots}
            onChanged={() => void reload()}
          />
        ) : (
          <RoomBrowser bots={bots} />
        )}
      </section>
    </div>
  );
}

type BrowserTab = "active" | "closed" | "issues";
const TAB_LABEL: Record<BrowserTab, string> = {
  active: "Active",
  closed: "Closed",
  issues: "Bot issues",
};
const EMPTY: Record<BrowserTab, string> = {
  active:
    "No active rooms. Your chief opens one when a task needs several bots, or start one yourself.",
  closed: "No closed rooms yet.",
  issues:
    "No bot issues. When a bot is blocked, your chief opens a room here to get it moving again.",
};

/** The room list for /rooms with no room open: find any room, including closed ones and the Chief's bot issues. */
function RoomBrowser({ bots }: { bots: Bot[] }) {
  const navigate = useNavigate();
  const { rooms } = useRooms();
  const [tab, setTab] = useState<BrowserTab>("active");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const all = rooms ?? [];
    // The server answers newest first, which is what browsing wants.
    const inTab = all.filter((d) =>
      tab === "issues"
        ? d.kind !== "room"
        : d.kind === "room" && closed(d.status) === (tab === "closed"),
    );
    return q ? inTab.filter((d) => roomLabel(d).toLowerCase().includes(q)) : inTab;
  }, [rooms, tab, q]);
  const newRoom = () => void navigate({ to: "/rooms", search: { new: true } });
  return (
    <>
      <PageHeader
        title="Rooms"
        icon={<HashIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
      >
        <Button size="sm" onClick={newRoom}>
          <PlusIcon className="size-4" aria-hidden="true" />
          New room
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-48 flex-1">
              <Input
                title="Find a room"
                hiddenLabel
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a room…"
                left={
                  <MagnifyingGlassIcon
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                }
              />
            </div>
            <div role="group" aria-label="Show" className="flex gap-0.5">
              {(Object.keys(TAB_LABEL) as BrowserTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "h-8 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    tab === t
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          {!rooms ? (
            <p role="status" className="py-6 text-sm text-muted-foreground">
              Loading…
            </p>
          ) : shown.length === 0 ? (
            <div className="space-y-3 py-10 text-center text-sm text-muted-foreground">
              <p className="mx-auto max-w-prose text-pretty">
                {q ? `No rooms match “${query.trim()}”.` : EMPTY[tab]}
              </p>
              {!q && tab === "active" && (
                <Button size="sm" variant="outline" onClick={newRoom}>
                  <PlusIcon className="size-4" aria-hidden="true" />
                  New room
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {shown.map((d) => (
                <BrowserRow key={d.id} d={d} bots={bots} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function BrowserRow({ d, bots }: { d: DiscussionListItem; bots: Bot[] }) {
  const status = roomStatus(d);
  return (
    <li>
      <Link
        to="/rooms"
        search={{ id: d.id }}
        className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <KindIcon kind={d.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{roomLabel(d)}</span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {d.members.map((m) => (
              <span key={m.botId} className="shrink-0">
                <BotAvatar bot={botOf(bots, m.botId)} size={16} />
              </span>
            ))}
            <span className="min-w-0 truncate">{d.members.map((m) => m.name).join(", ")}</span>
          </span>
        </span>
        {status && (
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
              STATUS_CLASS[d.awaitingApproval ? "stalled" : d.status],
            )}
          >
            {status}
          </span>
        )}
        <time
          dateTime={d.updatedAt}
          className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
        >
          {ago(d.updatedAt)}
        </time>
      </Link>
    </li>
  );
}

function RoomView({
  id,
  view,
  onView,
  bots,
  onChanged,
}: {
  id: string;
  view: "chat" | "canvas";
  onView: (v: "chat" | "canvas") => void;
  bots: Bot[];
  onChanged: () => void;
}) {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DiscussionDetail>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [briefs, setBriefs] = useState<Proposal[]>([]);
  const draft = useRef<DraftHandle | null>(null);
  const [edit, setEdit] = useState<{ title: string; goal: string; context: string }>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<{ turns: RoomTurn[]; tasks: RoomTask[] }>({
    turns: [],
    tasks: [],
  });
  const [openBot, setOpenBot] = useState<string>();
  const [loopForm, setLoopForm] = useState<{ goal: string; doneWhen: string }>();
  const [teamGoal, setTeamGoal] = useState<string>();
  const [details, setDetails] = useDetailsPanel();
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
          p.kind === "discussion_brief" || p.kind === "team_goals"
            ? p.patch?.discussionId === id
            : p.kind !== "open_discussion" &&
              Boolean(
                (p.proposedByBotId ?? p.botId) && memberIds.has((p.proposedByBotId ?? p.botId)!),
              ),
        ),
      );
    } catch (e) {
      fail(e);
    }
  }, [id, view, fail]);
  useEffect(() => {
    void load();
  }, [load]);
  // The teams a room can move into, and the shared context of its own team.
  useEffect(() => {
    teamsApi
      .list()
      .then(setTeams)
      .catch(() => {});
  }, [id]);
  // Opening the room closes its "is waiting" card. Once per open, not on each poll; a failure leaves the card as it was.
  useEffect(() => {
    void discussionsApi
      .seen(id)
      .then(() => refreshAttention())
      .catch(() => {});
  }, [id]);
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
  const rows = useMemo(() => transcriptRows(messages, liveChat.rows), [messages, liveChat.rows]);

  // The message the next post replies to. It belongs to one room, so it goes when the room changes.
  const [quoting, setQuoting] = useState<Row>();
  const [sent, setSent] = useState(0); // bumps on every send so the list jumps to the newest message
  useEffect(() => setQuoting(undefined), [id]);

  async function act(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await work();
      if (done) toast.success(done);
      await load();
      onChanged();
      void refreshAttention();
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  }
  async function send(out: Outgoing) {
    setBusy(true);
    try {
      await discussionsApi.post(id, out.text, { ...out, quotedMessageId: quoting?.id });
      draft.current?.clear();
      setQuoting(undefined);
      setSent((n) => n + 1);
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
    isClosed = closed(d.status),
    roomTeam = d.teamId ? teams.find((t) => t.id === d.teamId) : undefined;
  const running = detail.turns.find((t) => t.status === "running");
  const names = new Map(detail.members.map((m) => [m.botId, m.name]));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <section aria-label="Transcript" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader
          title={roomLabel(d)}
          icon={
            d.teamId ? (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <UsersThreeIcon aria-hidden="true" className="size-4" />
              </span>
            ) : (
              <KindIcon kind={d.kind} />
            )
          }
          {...(d.teamId ? { team: { teamId: d.teamId, roomId: id } } : {})}
        >
          {d.status !== "open" && (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                STATUS_CLASS[d.status],
              )}
            >
              {STATUS_LABEL[d.status]}
            </span>
          )}
          <button
            type="button"
            onClick={() => setDetails(true)}
            aria-label={`Members: ${detail.members.map((m) => m.name).join(", ")}`}
            className="hidden items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:flex"
          >
            {detail.members.slice(0, 4).map((m) => (
              <BotAvatar key={m.botId} bot={botOf(bots, m.botId)} size={20} />
            ))}
            {detail.members.length > 4 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                +{detail.members.length - 4}
              </span>
            )}
          </button>
          {d.teamId && (
            <div role="group" aria-label="Room view" className="flex gap-0.5">
              {(
                [
                  ["chat", "Chat"],
                  ["canvas", "Canvas"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => onView(v)}
                  className={cn(
                    "h-6 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    view === v
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <IconButton
            size="icon-sm"
            variant="ghost"
            title="Room details"
            aria-label="Room details"
            aria-pressed={details}
            onClick={() => setDetails(!details)}
          >
            <InfoIcon />
          </IconButton>
          {!isClosed && (
            <IconButton
              size="icon-sm"
              variant="ghost"
              title="Silence the bots: stop their messages and goal loops until you post"
              aria-label="Silence bots"
              disabled={busy || d.status === "paused"}
              onClick={() =>
                void act(
                  () => discussionsApi.silence(id).then(goalLoop.refresh),
                  "Bots silenced. They wait until you post.",
                )
              }
            >
              <SpeakerSlashIcon />
            </IconButton>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  title="Room actions"
                  aria-label="Room actions"
                  disabled={busy}
                />
              }
            >
              <DotsThreeIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {!isClosed && (
                <>
                  {d.createdByBotId && detail.members.length > 1 && goalLoop.loops.length === 0 && (
                    <DropdownMenuItem onClick={() => setLoopForm({ goal: d.goal, doneWhen: "" })}>
                      <RepeatIcon />
                      Pursue goal
                    </DropdownMenuItem>
                  )}
                  {d.teamId && (
                    <DropdownMenuItem onClick={() => setTeamGoal(d.goal)}>
                      <TargetIcon />
                      Set team goal
                    </DropdownMenuItem>
                  )}
                  {d.status === "open" ? (
                    <DropdownMenuItem
                      onClick={() => void act(() => discussionsApi.act(id, "pause"))}
                    >
                      <PauseIcon />
                      Pause
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => void act(() => discussionsApi.act(id, "resume"))}
                    >
                      <PlayIcon />
                      Resume
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      if (window.confirm("Stop all goals? The room and its history stay."))
                        void act(
                          () => discussionsApi.stopGoals(id).then(goalLoop.refresh),
                          "Goals stopped.",
                        );
                    }}
                  >
                    <StopCircleIcon />
                    Stop goals
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const summary = window.prompt("What was the outcome?");
                      if (summary?.trim())
                        void act(() => discussionsApi.resolve(id, summary.trim()), "Resolved.");
                    }}
                  >
                    <CheckCircleIcon />
                    Resolve
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm("Cancel this room? Queued bot turns are dropped."))
                        void act(() => discussionsApi.act(id, "cancel"));
                    }}
                  >
                    <XCircleIcon />
                    Cancel room
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this room? It stops and leaves your lists. Its history is kept.",
                    )
                  )
                    void act(
                      () =>
                        discussionsApi
                          .remove(id)
                          .then(() => navigate({ to: "/rooms", search: {} })),
                      "Room deleted.",
                    );
                }}
              >
                <TrashIcon />
                Delete room
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PageHeader>
        {(goalLoop.loops.length ? goalLoop.loops : goalLoop.loop ? [goalLoop.loop] : []).map(
          (l) => (
            <LoopBanner
              key={l.id}
              loop={l}
              owner={l.botId === d.createdByBotId ? undefined : names.get(l.botId)}
              onChange={goalLoop.update}
              onError={(m) => toast.error(m)}
            />
          ),
        )}
        {teamGoal !== undefined && (
          <Drawer
            open
            onClose={() => setTeamGoal(undefined)}
            title="Set the team goal"
            description="The chief reads it and proposes a goal for each member. Nothing starts until you approve."
          >
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const goal = teamGoal.trim();
                void act(async () => {
                  await discussionsApi.update(id, d.version, { goal });
                  await discussionsApi.post(id, `Team goal: ${goal}`);
                }, "The chief is on it.").then(() => setTeamGoal(undefined));
              }}
            >
              <MentionTextarea
                title="Goal"
                rows={4}
                maxLength={1000}
                bots={bots}
                value={teamGoal}
                onChange={setTeamGoal}
              />
              <Button type="submit" disabled={busy || !teamGoal.trim()}>
                Send to the chief
              </Button>
            </form>
          </Drawer>
        )}
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
              <MentionTextarea
                title="Goal"
                rows={3}
                maxLength={500}
                bots={bots}
                value={loopForm.goal}
                onChange={(goal) => setLoopForm({ ...loopForm, goal })}
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
              followToken={sent}
              rows={rows}
              bots={bots}
              authorOf={authorOf}
              busy={Boolean(working) || liveChat.busy}
              label="Room transcript"
              threads={false}
              actions={{
                onReact: (row, emoji) => void chatClient.react(row.id, emoji).then(load, fail),
                onReply: () => {},
                onQuote: setQuoting,
                onSaveToWiki: (row) =>
                  void chatClient
                    .saveToWiki(d.title, row.content)
                    .then(() => toast.success("Saved to your wiki."), fail),
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
                <DraftComposer
                  storageKey={draftKey(undefined, d.conversationId)}
                  handle={draft}
                  placeholder={`Message the room, e.g. @${detail.members[0]?.name.replace(/\s+/g, "") ?? "Bot"}`}
                  bots={bots.filter((b) => names.has(b.id))}
                  busy={busy}
                  conversationId={d.conversationId}
                  wiki
                  skillBots={detail.members.map((m) => m.botId)}
                  replyTo={
                    quoting && {
                      id: quoting.id,
                      name: authorOf(quoting).name,
                      excerpt: quoting.content,
                      onCancel: () => setQuoting(undefined),
                    }
                  }
                  onSubmit={send}
                  onError={fail}
                />
              )}
            </div>
          </>
        )}
      </section>
      {details && (
        <aside
          aria-label="Room details"
          className="max-h-[45%] min-w-0 shrink-0 space-y-5 overflow-x-hidden overflow-y-auto border-t p-4 text-sm break-words lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-base font-medium">Details</h3>
            <div className="flex items-center gap-1">
              {!isClosed && edit === undefined && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEdit({ title: d.title, goal: d.goal, context: d.context })}
                >
                  Edit
                </Button>
              )}
              <IconButton
                size="icon-sm"
                variant="ghost"
                aria-label="Close details"
                onClick={() => setDetails(false)}
              >
                <XIcon />
              </IconButton>
            </div>
          </div>
          {d.tainted && (
            <Alert theme="warn">
              This room includes outside content
              {d.originInbound ? ` (from ${d.originInbound.chatName})` : ""}. Bots that can change
              code wait for you to approve the brief.
            </Alert>
          )}
          {d.kind === "room" && !isClosed && (
            <Select
              title="Type"
              required={false}
              disabled={busy}
              value={d.teamId ?? ""}
              onChange={(e) =>
                void act(
                  () => discussionsApi.setTeam(id, e.target.value || null),
                  "Room type changed.",
                )
              }
              options={[
                { value: "", label: "Plain room" },
                ...teams.map((t) => ({ value: t.id, label: `Team: ${t.name}` })),
              ]}
            />
          )}
          {edit === undefined ? (
            <>
              <div className="space-y-1">
                <h4 className="label-mono">Goal</h4>
                <p className="whitespace-pre-wrap">{d.goal || "(not set)"}</p>
              </div>
              {d.summary && (
                <div className="space-y-1">
                  <h4 className="label-mono">Outcome</h4>
                  <p className="whitespace-pre-wrap">{d.summary}</p>
                </div>
              )}
              {roomTeam && (
                <div className="space-y-1">
                  <h4 className="label-mono">Team context</h4>
                  <p className="line-clamp-6 whitespace-pre-wrap break-words">
                    {roomTeam.context || "(empty)"}
                  </p>
                  <Link
                    className="text-xs text-primary hover:underline"
                    to="/teams/$teamId/settings"
                    params={{ teamId: roomTeam.id }}
                    search={{ room: id }}
                  >
                    Edit in team settings
                  </Link>
                </div>
              )}
              {detail.routines.length > 0 && (
                <div className="space-y-1">
                  <h4 className="label-mono">Routines</h4>
                  <ul className="space-y-1">
                    {detail.routines.map((r) => (
                      <li key={r.id}>
                        <Link
                          className="text-primary hover:underline"
                          to="/routines"
                          search={{ routine: r.id }}
                        >
                          {r.title}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground">{r.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-1">
                <h4 className="label-mono">
                  Room context <span className="font-normal normal-case">v{d.contextVersion}</span>
                </h4>
                <p className="whitespace-pre-wrap break-words">{d.context || "(empty)"}</p>
              </div>
            </>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await discussionsApi.update(id, d.version, {
                    title: edit.title.trim(),
                    goal: edit.goal.trim(),
                    context: edit.context,
                  });
                  setEdit(undefined);
                }, "Room saved.");
              }}
            >
              <Input
                title="Title"
                required
                maxLength={120}
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
              <MentionTextarea
                title="Goal"
                required={false}
                rows={3}
                maxLength={1000}
                bots={bots}
                value={edit.goal}
                onChange={(goal) => setEdit({ ...edit, goal })}
              />
              <MentionTextarea
                title="Room context"
                required={false}
                rows={8}
                maxLength={8000}
                bots={bots}
                value={edit.context}
                onChange={(context) => setEdit({ ...edit, context })}
              />
              <p className="text-xs text-muted-foreground">
                Changing the goal or the context asks again before a code bot acts on outside
                content.
              </p>
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={busy || !edit.title.trim()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setEdit(undefined)}>
                  Discard
                </Button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            <h4 className="label-mono">Bots</h4>
            <ul className="space-y-2.5">
              {detail.members.map((m) => (
                <li key={m.botId} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <BotAvatar bot={botOf(bots, m.botId)} size={20} />
                    <span className="min-w-0 truncate font-medium">{m.name}</span>
                    {m.botId === d.createdByBotId && (
                      <Badge variant="secondary" className="h-4 px-1 text-xs">
                        Facilitator
                      </Badge>
                    )}
                    {m.code && (
                      <Badge variant="outline" className="h-4 px-1 text-xs">
                        Code
                      </Badge>
                    )}
                  </div>
                  {m.role && <p className="pl-7 text-xs text-muted-foreground">{m.role}</p>}
                  {m.code && d.tainted && (
                    <div className="pl-7">
                      <Checkbox
                        checked={m.requireApproval}
                        disabled={busy || isClosed}
                        onChange={(e) =>
                          void act(() => discussionsApi.setApproval(id, m.botId, e.target.checked))
                        }
                      >
                        Ask me before it acts
                      </Checkbox>
                    </div>
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
      )}
    </div>
  );
}

function NewRoom({
  bots,
  onCancel,
  onCreated,
}: {
  bots: Bot[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const ready = bots.filter((b) => b.onboarded);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  // Ticked bots stay apart from the goal text, so a room can start with members and no goal.
  const [ticked, setTicked] = useState<string[]>([]);
  const mentioned = mentionedBots(task, ready);
  const picked = ready.filter((b) => ticked.includes(b.id) || mentioned.some((m) => m.id === b.id));
  useEffect(() => {
    // A team can start a room only with a chief and one more bot.
    teamsApi
      .list()
      .then((all) =>
        setTeams(
          all.filter((t) => t.members.length >= 2 && t.members.some((m) => m.kind === "chief")),
        ),
      )
      .catch(() => {});
  }, []);
  async function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    const title = String(f.get("title") ?? "");
    setBusy(true);
    try {
      if (teamId) {
        // The team's chief and bots join; the team context is shared with the room.
        const goal = task.trim();
        onCreated(
          await teamsApi.startRoom(teamId, {
            title,
            ...(goal ? { goal, firstMessage: goal } : {}),
          }),
        );
      } else {
        const d = await discussionsApi.create({
          title,
          goal: task.trim(),
          context: "",
          members: picked.map((b) => ({ bot: b.id })),
        });
        onCreated(d.id);
      }
      void refreshAttention();
    } catch (e) {
      toast.error(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <>
      <PageHeader
        title="New room"
        icon={<HashIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
      />
      <form
        className="mx-auto min-h-0 w-full max-w-5xl flex-1 space-y-4 overflow-y-auto p-4 md:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget);
        }}
      >
        <div className="space-y-1">
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
        <Select
          title="Team"
          required={false}
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          options={[
            { value: "", label: "No team: I pick the bots" },
            ...teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        <MentionTextarea
          title="What should the bots do? (optional)"
          value={task}
          onChange={setTask}
          bots={ready}
          required={false}
          rows={4}
          maxLength={1000}
          placeholder="Type @ to bring a bot in, e.g. @Dev fix the login crash, then @DaVinci check the screen"
        />
        {!teamId && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Bots</legend>
            {ready.length === 0 ? (
              <p className="text-xs text-muted-foreground">No ready bots yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {ready.map((b) => (
                  <label
                    key={b.id}
                    className="relative flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
                  >
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={picked.some((p) => p.id === b.id)}
                      onChange={(e) => {
                        setTicked((t) =>
                          e.target.checked ? [...t, b.id] : t.filter((id) => id !== b.id),
                        );
                        if (!e.target.checked) setTask((t) => withoutMention(t, b));
                      }}
                    />
                    <BotAvatar bot={b} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      {b.description && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {b.description}
                        </span>
                      )}
                    </span>
                    <CheckCircleIcon
                      weight="fill"
                      aria-hidden="true"
                      className="absolute top-2 right-2 size-4 text-primary opacity-0 peer-checked:opacity-100"
                    />
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || (!teamId && picked.length === 0)}>
            Start room
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}

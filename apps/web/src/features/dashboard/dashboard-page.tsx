import {
  BellIcon,
  CalendarDotsIcon,
  CheckCircleIcon,
  HashIcon,
  KanbanIcon,
  RobotIcon,
  UsersThreeIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { uuidv7 } from "@zetta/core/uuid";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { useAttentionSummary, useRunningDiscussions } from "../attention/summary";
import { chatClient, errorMessage, type Proposal } from "../chat/chat-client";
import { Composer, type Outgoing } from "../chat/composer";
import { useSidebarData } from "../chat/sidebar-data";
import { useDraft } from "../chat/use-draft";
import { relativeTime } from "../studio/routine-format";
import { tasksApi } from "../tasks/tasks-api";
import { greeting } from "./greeting";

const EXAMPLES_KEY = "zetta:home-examples";
const EXAMPLES: { icon: Icon; title: string; hint: string; prompt: string }[] = [
  {
    icon: RobotIcon,
    title: "Create a specialist bot",
    hint: "Turn a job into a bot with its own memory",
    prompt: "Create a specialist bot that ",
  },
  {
    icon: CalendarDotsIcon,
    title: "Schedule a routine",
    hint: "Have a bot do something on a schedule",
    prompt: "Every weekday at 9am, ",
  },
  {
    icon: UsersThreeIcon,
    title: "Set up a team",
    hint: "Group bots around one goal",
    prompt: "Set up a team that ",
  },
];

const examplesHidden = () => {
  try {
    return localStorage.getItem(EXAMPLES_KEY) === "hidden";
  } catch {
    return false;
  }
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { bots, chats, setChats } = useSidebarData();
  const attention = useAttentionSummary();
  const running = useRunningDiscussions();
  const chief = bots.find((b) => b.kind === "chief");
  const draft = useDraft(chief ? `home:${chief.id}` : undefined);
  const [sending, setSending] = useState(false);
  const [showExamples, setShowExamples] = useState(() => !examplesHidden());
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [openTasks, setOpenTasks] = useState<number>();
  const composer = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const firstName = session?.user.name?.split(" ")[0];

  useEffect(() => {
    void chatClient
      .proposals()
      .then(setProposals)
      .catch(() => {});
    void tasksApi
      .list()
      .then((tasks) => setOpenTasks(tasks.filter((t) => t.status !== "done").length))
      .catch(() => {});
  }, []);

  async function submit({ text, attachmentIds, fileRefs, wikiIds }: Outgoing) {
    if (!chief) return false;
    setSending(true);
    try {
      // Each message from here opens a new chat. The queue saves it and answers at once; the chat page follows the answer live.
      const chat = await chatClient.startConversation(chief.id);
      await chatClient.enqueue(chat.id, {
        clientRequestId: uuidv7(),
        content: text,
        attachmentIds,
        fileRefs,
        ...(wikiIds ? { wikiIds } : {}),
      });
      setChats((list) => [chat, ...list]);
      draft.clear();
      void navigate({ to: "/chat/{-$chatId}", params: { chatId: chat.id }, search: {} });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSending(false);
    }
  }

  const fill = (prompt: string) => {
    draft.set(prompt);
    composer.current?.querySelector("textarea")?.focus();
  };
  const hideExamples = () => {
    setShowExamples(false);
    try {
      localStorage.setItem(EXAMPLES_KEY, "hidden");
    } catch {
      // storage unavailable: the cards just come back next visit
    }
  };

  const approvalsChat = chats.find((c) => c.botId === proposals[0]?.botId)?.id;
  const pill =
    "flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted";
  const unread = attention?.unread ?? 0;
  const hasStats = proposals.length > 0 || unread > 0 || !!openTasks || running > 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 p-4 md:p-8">
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
        <div className="space-y-3 pt-4 text-center md:pt-12">
          <Logo size={56} className="mx-auto opacity-80" />
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(new Date().getHours())}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>

        {hasStats && (
          <ul className="flex flex-wrap justify-center gap-2" aria-label="Needs your attention">
            {proposals.length > 0 && (
              <li>
                <Link to="/chat/{-$chatId}" params={{ chatId: approvalsChat }} className={pill}>
                  <CheckCircleIcon aria-hidden /> {proposals.length} waiting for approval
                </Link>
              </li>
            )}
            {unread > 0 && (
              <li>
                <Link to="/studio/$tab" params={{ tab: "attention" }} className={pill}>
                  <BellIcon aria-hidden /> {unread} unread in inbox
                </Link>
              </li>
            )}
            {!!openTasks && (
              <li>
                <Link to="/tasks" className={pill}>
                  <KanbanIcon aria-hidden /> {openTasks} open tasks
                </Link>
              </li>
            )}
            {running > 0 && (
              <li>
                <Link to="/rooms" className={pill}>
                  <HashIcon aria-hidden /> {running} discussions running
                </Link>
              </li>
            )}
          </ul>
        )}

        {showExamples && (
          <section aria-label="Examples" className="space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <h2 className="text-sm font-normal">Get started with some examples</h2>
              <button
                type="button"
                onClick={hideExamples}
                aria-label="Hide examples"
                className="rounded p-1 hover:bg-muted"
              >
                <XIcon aria-hidden />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {EXAMPLES.map(({ icon: Glyph, title, hint, prompt }) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => fill(prompt)}
                  className="flex flex-col gap-6 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted"
                >
                  <Glyph aria-hidden className="size-5 text-muted-foreground" />
                  <span className="space-y-1">
                    <span className="block font-medium">{title}</span>
                    <span className="block text-sm text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {chats.length > 0 && (
          <section aria-label="Recent chats">
            <h2 className="mb-1 px-3 text-sm font-normal text-muted-foreground">Recent chats</h2>
            <ul>
              {chats.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link
                    to="/chat/{-$chatId}"
                    params={{ chatId: c.id }}
                    className="flex items-center justify-between gap-4 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <span className="truncate">{c.title || "New chat"}</span>
                    <span className="shrink-0 text-sm">{relativeTime(c.updatedAt, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div ref={composer} className="shrink-0">
        <Composer
          value={draft.value}
          onChange={draft.set}
          placeholder={chief ? `Ask ${chief.name}…` : "Loading…"}
          bots={bots}
          busy={sending}
          disabled={!chief}
          autoFocus
          wiki
          onSubmit={submit}
          onError={(e) => toast.error(errorMessage(e))}
        />
      </div>
    </div>
  );
}

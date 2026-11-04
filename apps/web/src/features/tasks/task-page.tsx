import { uuidv7 } from "@zetta/core/uuid";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CaretDownIcon,
  ChatIcon,
  PaperPlaneRightIcon,
  SparkleIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@zetta/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { BotIdentity } from "@/components/bot-identity";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";
import { authClient } from "@/lib/auth-client";
import { relativeTime } from "../shared/relative-time";
import { chatClient, errorMessage, type Bot, type Message } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Markdown } from "../chat/markdown";
import { MentionField } from "../chat/mention";
import { stripToolFences } from "../chat/tool-fences";
import { Badge, ConfirmButton, Empty, field } from "../shared/ui";
import { PriorityIcon, priorityLabel } from "./task-badges";
import { LabelsEditor } from "./task-labels";
import { extractLinks } from "./task-links";
import {
  TASK_COLUMNS,
  TASK_PRIORITIES,
  tasksApi,
  tasksQueries,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "./tasks-api";

const POLL_MS = 5000;
const label = (status: TaskStatus) => TASK_COLUMNS.find((c) => c.status === status)!.label;

/** What the thread shows: the main line of the chat, without tool-only turns. */
const visible = (all: Message[]) =>
  all
    .filter((m) => !m.parentMessageId && m.role !== "system")
    .map((m) => ({
      ...m,
      content: m.role === "assistant" ? stripToolFences(m.content) : m.content,
    }))
    .filter((m) => m.content.trim());

/** The bot is waiting on the person when the last finished message of the thread is the bot's. */
const pendingAnswer = (thread: Message[]) => {
  const last = thread.at(-1);
  return last?.role === "assistant" && last.status === "complete" ? last : undefined;
};

/** Poll while the bot has the turn: the last message of the thread is not the bot's finished answer. */
const botHasTurn = (all: Message[] | undefined) => {
  const shown = visible(all ?? []);
  return shown.length > 0 && !pendingAnswer(shown);
};
const NO_BOTS: Bot[] = [];
const NO_MESSAGES: Message[] = [];

const SUMMARY_MARK = "[AI Summary]";
const SUMMARY_PROMPT = `${SUMMARY_MARK} Summarize this task for someone who joins now, in under 120 words and in Markdown: where the work stands, decisions made, what is still open, and the next step. Name at most 3 links that matter. Do not use tools and do not change the task.`;
const LINKS_SHOWN = 4;

/** Splits the thread into the summary requests (and the bot's answers to them) and the real conversation. The latest pair feeds the summary card. */
function splitSummary(thread: Message[]) {
  const rest: Message[] = [];
  let prompt: Message | undefined;
  let answer: Message | undefined;
  let waiting = false;
  for (const m of thread) {
    if (m.role === "user" && m.content.startsWith(SUMMARY_MARK)) {
      prompt = m;
      answer = undefined;
      waiting = true;
    } else if (waiting && m.role === "assistant") {
      answer = m;
      waiting = false;
    } else rest.push(m);
  }
  return { prompt, answer, rest };
}

type Change = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
};

/** The task page: a back link and the task. */
export function TaskPage({ id }: { id: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-8">
        <Link
          to="/tasks"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Tasks
        </Link>
        <TaskDetail id={id} variant="page" />
      </div>
    </div>
  );
}

/**
 * One task: its details on the left, the thread with the bot and the open question below, the properties on the right.
 * `peek` is the same task inside the side panel of the board, where the properties move under the details until the panel is wide.
 */
export function TaskDetail({
  id,
  variant,
  initial,
  knownLabels = [],
  onChange,
  onDeleted,
}: {
  id: string;
  variant: "page" | "peek";
  /** A copy of the task the caller already has, to paint at once while the fresh one loads. */
  initial?: Task;
  /** Labels in use on other tasks, offered when you add a label. */
  knownLabels?: string[];
  /** Called with the saved task, so a list around this view stays in step. */
  onChange?: (task: Task) => void;
  /** Called after the task is deleted. Without it, the view goes back to the board. */
  onDeleted?: () => void;
}) {
  const tf = useTimeFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const taskKey = tasksQueries.detail(id).queryKey;
  // `initial` only paints the first frame; the fresh copy replaces it.
  const taskQuery = useQuery({ ...tasksQueries.detail(id), placeholderData: initial });
  const task: Task | null | undefined =
    taskQuery.isError && !taskQuery.data ? null : taskQuery.data;
  const setTask = (next: Task | null | undefined) => {
    if (next) qc.setQueryData<Task>(taskKey, next);
  };
  const [asking, setAsking] = useState(false);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const fail = (e: unknown) => toast.error(errorMessage(e));
  const viewerId = authClient.useSession().data?.user.id;
  // A person a bot asked, who does not own the task, sees it and moves it. The chat behind it is the owner's, so it stays hidden.
  const guest = !!task && !!viewerId && task.ownerUserId !== viewerId;

  const botId = task?.botId;
  // All the bots, for the `@` picker of the reply and the description; the task's own bot shows in the header.
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const bot = botId ? bots.find((b) => b.id === botId) : undefined;

  const conversationId = guest ? undefined : task?.conversationId;
  const threadQuery = useQuery({
    ...chatQueries.messages(conversationId ?? ""),
    enabled: !!conversationId,
    select: visible,
    refetchInterval: (q) => (botHasTurn(q.state.data) ? POLL_MS : false),
  });
  const thread = threadQuery.data ?? NO_MESSAGES;
  const waitingOnBot = thread.length > 0 && !pendingAnswer(thread);
  const loadThread = () =>
    qc.invalidateQueries({ queryKey: chatQueries.messages(conversationId ?? "").queryKey });

  const patch = (change: Change) => {
    const before = task;
    if (task) setTask({ ...task, ...change });
    const request = change.status ? tasksApi.move(id, change.status) : tasksApi.update(id, change);
    request.then(
      (saved) => {
        setTask(saved);
        onChange?.(saved);
      },
      (e) => {
        setTask(before);
        fail(e);
      },
    );
  };
  const remove = () =>
    tasksApi.remove(id).then(
      () => void (onDeleted ? onDeleted() : navigate({ to: "/tasks" })),
      (e) => void fail(e),
    );
  const reply = async (content: string) => {
    if (!conversationId) return;
    await chatClient
      .enqueue(conversationId, { clientRequestId: uuidv7(), content })
      .then(() => loadThread(), fail);
  };

  const { prompt, answer, rest } = useMemo(() => splitSummary(thread), [thread]);
  const summarizing = asking || (!!prompt && (!answer || answer.status === "running"));
  const summaryFailed = !summarizing && !!answer && answer.status !== "complete";
  const summarize = () => {
    setAsking(true);
    void reply(SUMMARY_PROMPT).finally(() => setAsking(false));
  };

  const pending = task && task.status !== "done" ? pendingAnswer(rest) : undefined;
  const description = task?.description ?? "";
  /** The description first, then the thread from the newest message: the links that matter are the recent ones. */
  const links = useMemo(
    () =>
      extractLinks([description, ...rest.map((m) => m.content).reverse()], window.location.origin),
    [description, rest],
  );
  const lastActivity = thread.at(-1)?.createdAt ?? task?.updatedAt;

  const peek = variant === "peek";
  return (
    <div className="@container">
      <div className="flex flex-col gap-5">
        {task === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : task === null ? (
          <Empty>This task does not exist or was deleted.</Empty>
        ) : (
          <div
            className={
              peek
                ? "grid gap-6 @2xl:grid-cols-[minmax(0,1fr)_14rem]"
                : "grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]"
            }
          >
            <main className="flex min-w-0 flex-col gap-6">
              {guest ? (
                <>
                  <h1
                    className={`break-words ${peek ? "text-xl font-medium" : "text-2xl font-medium"}`}
                  >
                    {task.title}
                  </h1>
                  {task.description && (
                    <div className="text-sm">
                      <Markdown source={task.description} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <EditableText
                    key={`title-${task.updatedAt}`}
                    value={task.title}
                    label="Title"
                    maxLength={200}
                    required
                    className={peek ? "text-xl font-medium" : "text-2xl font-medium"}
                    onSave={(title) => patch({ title })}
                  />
                  <EditableText
                    key={`description-${task.updatedAt}`}
                    value={task.description}
                    label="Description"
                    placeholder="Add description…"
                    maxLength={4000}
                    multiline
                    bots={bots}
                    className="text-sm"
                    onSave={(description) => patch({ description })}
                  />
                </>
              )}
              {task.assignee === "person" &&
                task.assigneeUserId === viewerId &&
                task.status !== "done" && (
                  <section
                    aria-label="Waiting for you"
                    className="flex flex-col gap-2 rounded-lg border border-attention/60 bg-attention/5 p-4"
                  >
                    <Badge tone="warning">Waiting for you</Badge>
                    <p className="text-sm">
                      A bot needs this from you. Mark it as done when it is met. The bot is told
                      each time you change the status.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="self-start"
                      onClick={() => patch({ status: "done" })}
                    >
                      Mark as done
                    </Button>
                  </section>
                )}
              {!guest && (
                <section aria-label="AI Summary" className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!conversationId || summarizing}
                      title={conversationId ? undefined : "This task has no thread to summarize."}
                      onClick={summarize}
                    >
                      <SparkleIcon /> {summarizing ? "Summarizing…" : "AI Summary"}
                    </Button>
                    {answer?.status === "complete" && answer.createdAt && (
                      <time
                        dateTime={answer.createdAt}
                        className="text-xs text-muted-foreground"
                        title={formatDateTime(answer.createdAt, tf)}
                      >
                        {relativeTime(answer.createdAt)}
                      </time>
                    )}
                  </div>
                  {summaryFailed && (
                    <p className="text-sm text-destructive">The summary failed. Try again.</p>
                  )}
                  {answer?.status === "complete" && !summarizing && (
                    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                      <Markdown source={answer.content} />
                    </div>
                  )}
                </section>
              )}
              {pending && (
                <section
                  aria-label="Waiting for your answer"
                  className="flex flex-col gap-2 rounded-lg border border-attention/60 bg-attention/5 p-4"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone="warning">Waiting for your answer</Badge>
                    <time
                      dateTime={pending.createdAt}
                      className="text-xs text-muted-foreground"
                      title={pending.createdAt ? formatDateTime(pending.createdAt, tf) : undefined}
                    >
                      {pending.createdAt ? relativeTime(pending.createdAt) : ""}
                    </time>
                  </div>
                  <div className="text-sm">
                    <Markdown source={pending.content} />
                  </div>
                </section>
              )}
              {!guest && (
                <section aria-label="Activity" className="flex flex-col gap-3 border-t pt-4">
                  <h2 className="text-sm font-medium">Activity</h2>
                  {!conversationId ? (
                    <p className="text-sm text-muted-foreground">
                      This task has no thread. A bot links one when it creates the task from a chat.
                    </p>
                  ) : rest.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages in the thread yet.</p>
                  ) : (
                    <ol className="flex flex-col gap-3">
                      {rest.map((m) => (
                        <ThreadMessage
                          key={m.id}
                          message={m}
                          bot={bot}
                          pending={m.id === pending?.id}
                        />
                      ))}
                    </ol>
                  )}
                  {conversationId && <ReplyBox bots={bots} onSend={reply} />}
                </section>
              )}
            </main>
            <aside className={`flex flex-col gap-6 text-sm ${peek ? "" : "lg:pt-2"}`}>
              <section aria-label="Properties" className="flex flex-col gap-2">
                <h2 className="text-xs font-medium text-muted-foreground">Properties</h2>
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                    {label(task.status)}
                    <CaretDownIcon aria-hidden="true" className="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    {TASK_COLUMNS.filter((c) => c.status !== task.status).map((c) => (
                      <DropdownMenuItem key={c.status} onClick={() => patch({ status: c.status })}>
                        {c.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {guest ? (
                  <p className="inline-flex items-center gap-1.5">
                    <PriorityIcon priority={task.priority} />
                    {priorityLabel(task.priority)}
                  </p>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Priority: ${priorityLabel(task.priority)}`}
                      className="inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <PriorityIcon priority={task.priority} />
                      {priorityLabel(task.priority)}
                      <CaretDownIcon aria-hidden="true" className="size-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      {TASK_PRIORITIES.filter((p) => p.priority !== task.priority).map((p) => (
                        <DropdownMenuItem
                          key={p.priority}
                          onClick={() => patch({ priority: p.priority })}
                        >
                          <PriorityIcon priority={p.priority} />
                          {p.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {!guest && (
                  <LabelsEditor
                    labels={task.labels}
                    known={knownLabels}
                    onChange={(labels) => patch({ labels })}
                  />
                )}
                {task.assignee === "person" && (
                  <p className="inline-flex items-center gap-1.5">
                    <UserCircleIcon aria-hidden className="size-5 text-muted-foreground" />
                    <span className="text-muted-foreground">Assigned to</span>{" "}
                    {task.assigneeUserId === viewerId ? "you" : (task.assigneeName ?? "a person")}
                  </p>
                )}
                {task.botId && !guest && (
                  <BotIdentity
                    bot={bot ?? { id: task.botId, name: "Deleted bot" }}
                    size={24}
                    sub={task.assignee === "person" ? "Asked by" : "Assigned bot"}
                  />
                )}
              </section>
              {conversationId && (
                <section aria-label="Summary" className="flex flex-col gap-1">
                  <h2 className="text-xs font-medium text-muted-foreground">Summary</h2>
                  <p>
                    {pending
                      ? "Waiting for your answer"
                      : waitingOnBot
                        ? "The bot is working"
                        : rest.length
                          ? "No open question"
                          : "No messages yet"}
                  </p>
                  <p className="text-muted-foreground">
                    {rest.length} message{rest.length === 1 ? "" : "s"} ·{" "}
                    {rest.filter((m) => m.role === "user").length} from you
                  </p>
                  {lastActivity && (
                    <p className="text-muted-foreground" title={formatDateTime(lastActivity, tf)}>
                      Last activity {relativeTime(lastActivity)}
                    </p>
                  )}
                </section>
              )}
              {links.length > 0 && (
                <section aria-label="Links" className="flex flex-col gap-1">
                  <h2 className="text-xs font-medium text-muted-foreground">Links</h2>
                  <ul className="flex flex-col gap-1">
                    {(showAllLinks ? links : links.slice(0, LINKS_SHOWN)).map((l) => (
                      <li key={l.url} className="min-w-0">
                        {l.internal ? (
                          <Link to={l.url as never} className="block truncate hover:underline">
                            {l.label}
                          </Link>
                        ) : (
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={l.url}
                            className="block truncate hover:underline"
                          >
                            {l.label}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  {links.length > LINKS_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setShowAllLinks((v) => !v)}
                      className="w-fit text-xs text-muted-foreground hover:text-foreground"
                    >
                      {showAllLinks ? "Show fewer" : `Show ${links.length - LINKS_SHOWN} more`}
                    </button>
                  )}
                </section>
              )}
              <section aria-label="Dates" className="flex flex-col gap-1 text-muted-foreground">
                <h2 className="text-xs font-medium">Dates</h2>
                <p title={formatDateTime(task.createdAt, tf)}>
                  Created {relativeTime(task.createdAt)}
                </p>
                <p title={formatDateTime(task.updatedAt, tf)}>
                  Updated {relativeTime(task.updatedAt)}
                </p>
              </section>
              <div className="flex flex-col items-start gap-2">
                {conversationId && (
                  <Link
                    to="/chat/{-$chatId}"
                    params={{ chatId: conversationId }}
                    className="inline-flex items-center gap-1.5 hover:underline"
                  >
                    <ChatIcon aria-hidden="true" className="size-4" /> Open the chat
                  </Link>
                )}
                {!guest && (
                  <ConfirmButton
                    label="Delete"
                    question="Delete this task for good?"
                    confirmLabel="Delete"
                    variant="destructive"
                    onConfirm={remove}
                  />
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadMessage({
  message,
  bot,
  pending,
}: {
  message: Message;
  bot: Bot | undefined;
  pending: boolean;
}) {
  const mine = message.role === "user";
  return (
    <li
      className={`flex flex-col gap-1 rounded-md border p-3 text-sm ${mine ? "bg-muted/40" : "bg-background"} ${pending ? "border-attention/60" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{mine ? "You" : (bot?.name ?? "Bot")}</span>
        {message.createdAt && (
          <time dateTime={message.createdAt}>{relativeTime(message.createdAt)}</time>
        )}
        {message.status === "running" && <Badge>Working</Badge>}
        {message.queue === "pending" && <Badge>Queued</Badge>}
        {(message.status === "failed" || message.queue === "failed") && (
          <Badge tone="danger">Failed</Badge>
        )}
      </div>
      <Markdown source={message.content} />
    </li>
  );
}

function ReplyBox({ bots, onSend }: { bots: Bot[]; onSend: (content: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    await onSend(content);
    setText("");
    setSending(false);
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <MentionField
        aria-label="Reply"
        placeholder="Leave a reply…"
        rows={3}
        maxLength={20000}
        value={text}
        onChange={setText}
        bots={bots}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className={field}
      />
      <Button type="submit" size="sm" className="self-end" disabled={!text.trim() || sending}>
        <PaperPlaneRightIcon /> Reply
      </Button>
    </form>
  );
}

/** Text that saves when it loses focus, and only when it changed. An empty value is kept out when `required`. */
function EditableText({
  value,
  label: name,
  placeholder,
  maxLength,
  multiline,
  required,
  className,
  bots,
  onSave,
}: {
  value: string;
  label: string;
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
  required?: boolean;
  className: string;
  /** The `@` and `#` picker of the chat, on a multiline text. */
  bots?: Bot[];
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const save = () => {
    const next = draft.trim();
    if (next === value || (required && !next)) return setDraft(value);
    onSave(next);
  };
  const shared = {
    "aria-label": name,
    placeholder,
    maxLength,
    value: draft,
    onBlur: save,
    className: `w-full min-w-0 rounded-md bg-transparent px-1 -mx-1 placeholder:text-muted-foreground hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring/40 focus-within:bg-muted/40 focus-within:outline-2 focus-within:outline-ring/40 ${className}`,
  };
  return multiline ? (
    <MentionField
      {...shared}
      rows={4}
      value={draft}
      onChange={setDraft}
      bots={bots ?? []}
      onBlur={save}
    />
  ) : (
    <input
      {...shared}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

import { Link } from "@tanstack/react-router";
import { MessageSquare, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Button } from "@zetta/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { Input } from "@/components/ui";
import { BotAvatar } from "@/components/bot-avatar";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { TASK_COLUMNS, tasksApi, type Task, type TaskStatus } from "./tasks-api";

/** The shared board: one fixed set of columns for every bot of the user. Bots move their own cards; the user can drag or use the card menu. */
export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [over, setOver] = useState<TaskStatus>();
  const fail = (e: unknown) => toast.error(errorMessage(e));

  useEffect(() => {
    tasksApi
      .list()
      .then(setTasks, fail)
      .finally(() => setLoaded(true));
    chatClient.bots().then(setBots, () => {});
  }, []);

  const move = (id: string, status: TaskStatus) => {
    const before = tasks;
    if (before.find((t) => t.id === id)?.status === status) return;
    setTasks((all) => all.map((t) => (t.id === id ? { ...t, status } : t)));
    tasksApi.move(id, status).catch((e) => {
      setTasks(before);
      fail(e);
    });
  };
  const remove = (id: string) => {
    const before = tasks;
    setTasks((all) => all.filter((t) => t.id !== id));
    tasksApi.remove(id).catch((e) => {
      setTasks(before);
      fail(e);
    });
  };
  const add = () => {
    const value = title.trim();
    if (!value) return;
    setTitle("");
    tasksApi.create(value).then((t) => setTasks((all) => [t, ...all]), fail);
  };
  const drop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setOver(undefined);
    const id = e.dataTransfer.getData("text/plain");
    if (id) move(id, status);
  };

  return (
    <main className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-base font-semibold">Tasks</h1>
        <form
          className="ml-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            aria-label="New task"
            placeholder="New task"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 w-56 text-sm"
          />
          <Button type="submit" size="sm" aria-label="Add task">
            <Plus /> Add
          </Button>
        </form>
      </header>
      {loaded && tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tasks yet. Add one, or ask a bot to turn a request into a task.
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-3 overflow-x-auto">
        {TASK_COLUMNS.map(({ status, label }) => {
          const cards = tasks.filter((t) => t.status === status);
          return (
            <section
              key={status}
              aria-label={label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver(undefined)}
              onDrop={(e) => drop(e, status)}
              className={`flex min-h-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2 ${over === status ? "ring-2 ring-ring" : ""}`}
            >
              <h2 className="px-1 text-xs font-medium text-muted-foreground">
                {label} · {cards.length}
              </h2>
              <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                {cards.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    bot={bots.find((b) => b.id === t.botId)}
                    onMove={(to) => move(t.id, to)}
                    onDelete={() => remove(t.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function TaskCard({
  task,
  bot,
  onMove,
  onDelete,
}: {
  task: Task;
  bot: Bot | undefined;
  onMove: (to: TaskStatus) => void;
  onDelete: () => void;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
      className="flex flex-col gap-1.5 rounded-md border bg-background p-2 text-sm shadow-xs"
    >
      <div className="flex items-start gap-1">
        <span className="min-w-0 flex-1 break-words font-medium">{task.title}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${task.title} menu`}
            className="rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {TASK_COLUMNS.filter((c) => c.status !== task.status).map((c) => (
              <DropdownMenuItem key={c.status} onClick={() => onMove(c.status)}>
                Move to {c.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {task.description && (
        <p className="line-clamp-3 break-words text-xs text-muted-foreground">{task.description}</p>
      )}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {bot && (
          <>
            <BotAvatar bot={bot} size={16} square />
            <span className="truncate">{bot.name}</span>
          </>
        )}
        {task.conversationId && (
          <Link
            to="/chat/{-$chatId}"
            params={{ chatId: task.conversationId }}
            className="ml-auto inline-flex items-center gap-1 hover:underline"
          >
            <MessageSquare className="size-3" /> Thread
          </Link>
        )}
      </div>
    </li>
  );
}

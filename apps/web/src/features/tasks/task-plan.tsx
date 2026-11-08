import { Link } from "@tanstack/react-router";
import { TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Checkbox, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Markdown } from "../chat/markdown";
import { relativeTime } from "../shared/relative-time";
import { Badge } from "../shared/ui";
import { FollowUpChip } from "./task-badges";
import { followUpView } from "./task-steps";
import { tasksApi, tasksQueries, type Task, type TaskStatus } from "./tasks-api";

/**
 * The steps of a task as a checklist. A bot writes its plan here (zetta:task with subtasks) and ticks the steps as it works; a person can
 * tick, add and remove steps too. The list is the cache of the board, so a tick shows at once and a failed write puts it back.
 */
export function TaskSteps({ task, steps }: { task: Task; steps: Task[] }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const key = tasksQueries.list().queryKey;
  const settle = () => void qc.invalidateQueries({ queryKey: ["tasks"] });
  const fail = (e: unknown) => toast.error(errorMessage(e));
  const setStatus = (id: string, status: TaskStatus) => {
    const before = qc.getQueryData<Task[]>(key);
    qc.setQueryData<Task[]>(key, (all) => all?.map((t) => (t.id === id ? { ...t, status } : t)));
    tasksApi
      .move(id, status)
      .catch((e) => {
        qc.setQueryData<Task[]>(key, before);
        fail(e);
      })
      .finally(settle);
  };
  const add = () => {
    const value = title.trim();
    if (!value) return;
    setTitle("");
    tasksApi
      .create(value, undefined, task.id)
      .catch((e) => {
        setTitle(value);
        fail(e);
      })
      .finally(settle);
  };
  const remove = (id: string) => {
    const before = qc.getQueryData<Task[]>(key);
    qc.setQueryData<Task[]>(key, (all) => all?.filter((t) => t.id !== id));
    tasksApi
      .remove(id)
      .catch((e) => {
        qc.setQueryData<Task[]>(key, before);
        fail(e);
      })
      .finally(settle);
  };
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <section aria-label="Steps" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Steps</h2>
        {steps.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{steps.length} done
          </span>
        )}
      </div>
      {steps.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No steps yet. A bot writes its plan here when the work takes more than one reply.
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-lg border">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <Checkbox
              checked={s.status === "done"}
              onChange={(e) => setStatus(s.id, e.target.checked ? "done" : "backlog")}
              container="min-w-0 flex-1"
            >
              <span className={s.status === "done" ? "text-muted-foreground line-through" : ""}>
                {s.title}
              </span>
            </Checkbox>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove step ${s.title}`}
              title="Remove step"
              onClick={() => remove(s.id)}
            >
              <TrashIcon aria-hidden className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Input
        hiddenLabel
        title="New step"
        size="small"
        placeholder="Add a step, Enter to add"
        maxLength={200}
        container="w-full"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          add();
        }}
      />
    </section>
  );
}

/**
 * Whether the server calls the bot back about this task, and the bot's own note on where it stopped. "Following": the bot is called back
 * while the task is open. "Paused": the server stopped (no progress, failures, the check cap, or Stop) and says why; Resume starts again.
 */
export function TaskFollowUp({
  task,
  now = Date.now(),
  onFollowUp,
}: {
  task: Task;
  now?: number;
  onFollowUp: (to: "auto" | "off") => void;
}) {
  const view = followUpView(task);
  const open = task.status === "backlog" || task.status === "in_progress";
  // Only a task a bot took on can be followed: the server needs its bot and chat to call back.
  const followable = open && !!task.botId && !!task.conversationId;
  if (!view && !task.progress && !followable) return null;
  return (
    <section aria-label="Follow-up" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Follow-up</h2>
        <FollowUpChip task={task} />
      </div>
      {task.followUp === "auto" && view && (
        <p className="text-sm text-muted-foreground">
          The bot is called back while this task is open.
          {task.nextCheckAt ? ` Next check ${relativeTime(task.nextCheckAt, now)}.` : ""}
          {task.followUpReason ? ` ${task.followUpReason}.` : ""}
        </p>
      )}
      {task.followUp === "paused" && (
        <p className="text-sm text-muted-foreground">
          The bot is no longer called back{task.followUpReason ? `: ${task.followUpReason}` : ""}.
        </p>
      )}
      {task.followUp === "off" && followable && (
        <p className="text-sm text-muted-foreground">
          Nobody follows this task. Follow it and the bot is called back until it is done.
        </p>
      )}
      {open && task.followUp === "auto" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => onFollowUp("off")}
        >
          Stop following
        </Button>
      )}
      {open && task.followUp === "paused" && (
        <Button type="button" size="sm" className="self-start" onClick={() => onFollowUp("auto")}>
          Resume
        </Button>
      )}
      {task.followUp === "off" && followable && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => onFollowUp("auto")}
        >
          Follow up
        </Button>
      )}
      {task.progress && (
        <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
          <Badge>Progress note</Badge>
          <div className="text-sm">
            <Markdown source={task.progress} />
          </div>
        </div>
      )}
    </section>
  );
}

/** A step names the task it belongs to; the link goes back to it. */
export function StepOf({ parentId }: { parentId: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      A step of{" "}
      <Link to="/tasks/$taskId" params={{ taskId: parentId }} className="underline">
        its task
      </Link>
      .
    </p>
  );
}

import { Link } from "@tanstack/react-router";
import { UserCircleDashedIcon, UserCircleIcon } from "@phosphor-icons/react";
import type { MouseEvent } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import type { Bot } from "../chat/chat-client";
import { relativeTime } from "../studio/routine-format";
import { LabelChips, PriorityIcon, StatusIcon } from "./task-badges";
import { NO_BOT, type GroupBy, type TaskGroup } from "./task-filters";
import type { Task, TaskStatus } from "./tasks-api";

/** The title of a task. It opens the task in the side panel; ctrl or cmd click still opens a new tab. */
export function TaskTitleLink({ task, className }: { task: Task; className?: string }) {
  return (
    <Link to="/tasks" search={(prev) => ({ ...prev, task: task.id })} className={className}>
      {task.title}
    </Link>
  );
}

/** A click on a card or row that is not on a link or a button opens the task. */
export const openOnClick = (open: () => void) => (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest("a, button, [role=menuitem]")) open();
};

export function GroupIcon({
  group,
  groupBy,
  bots,
}: {
  group: TaskGroup;
  groupBy: GroupBy;
  bots: Bot[];
}) {
  if (groupBy === "status") return <StatusIcon status={group.key as TaskStatus} />;
  if (group.key.startsWith("person:"))
    return <UserCircleIcon aria-hidden className="size-5 text-attention" />;
  const bot = bots.find((b) => b.id === group.key);
  return bot && group.key !== NO_BOT ? (
    <BotAvatar bot={bot} size={20} square />
  ) : (
    <UserCircleDashedIcon aria-hidden className="size-5 text-muted-foreground" />
  );
}

/** The same groups as the board, as rows. */
export function TaskList({
  groups,
  groupBy,
  bots,
  now,
  openId,
  onOpen,
}: {
  groups: TaskGroup[];
  groupBy: GroupBy;
  bots: Bot[];
  now: number;
  openId: string | undefined;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} className="flex flex-col">
          <header className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5">
            <GroupIcon group={group} groupBy={groupBy} bots={bots} />
            <h2 className="text-sm font-medium">{group.label}</h2>
            <span className="text-sm text-muted-foreground tabular-nums">{group.tasks.length}</span>
          </header>
          <ul className="flex flex-col divide-y">
            {group.tasks.map((task) => {
              const bot = bots.find((b) => b.id === task.botId);
              return (
                <li
                  key={task.id}
                  onClick={openOnClick(() => onOpen(task.id))}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/50 ${task.id === openId ? "bg-muted/70" : ""}`}
                >
                  <PriorityIcon priority={task.priority} />
                  <StatusIcon status={task.status} />
                  <TaskTitleLink
                    task={task}
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                  />
                  <span className="hidden items-center gap-1 sm:flex">
                    <LabelChips labels={task.labels} />
                  </span>
                  {task.assignee === "person" && (
                    <span
                      title={`Assigned to ${task.assigneeName ?? "a person"}`}
                      className="shrink-0"
                    >
                      <UserCircleIcon aria-hidden className="size-5 text-attention" />
                    </span>
                  )}
                  {bot && (
                    <span title={bot.name} className="shrink-0">
                      <BotAvatar bot={bot} size={20} square />
                    </span>
                  )}
                  <span
                    title={new Date(task.updatedAt).toLocaleString()}
                    className="w-20 shrink-0 text-right text-xs text-muted-foreground"
                  >
                    {relativeTime(task.updatedAt, now)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

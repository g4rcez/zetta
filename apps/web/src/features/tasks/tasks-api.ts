import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";
import { topLevel } from "./task-steps";

export const TASK_COLUMNS = [
  { status: "backlog", label: "Backlog" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
] as const;
export type TaskStatus = (typeof TASK_COLUMNS)[number]["status"];
export const TASK_PRIORITIES = [
  { priority: "none", label: "No priority" },
  { priority: "low", label: "Low" },
  { priority: "medium", label: "Medium" },
  { priority: "high", label: "High" },
  { priority: "urgent", label: "Urgent" },
] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number]["priority"];
/** Whether the server calls the bot back while the task is open: "auto" it does, "paused" it stopped (see `followUpReason`), "off" nobody follows it. */
export type TaskFollowUp = "auto" | "paused" | "off";
export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  ownerUserId: string;
  /** "person": a bot asked `assigneeUserId` for something, and `botId` is the bot that asked. */
  assignee: "bot" | "person";
  assigneeUserId: string | null;
  assigneeName: string | null;
  botId: string | null;
  conversationId: string | null;
  /** Set on a step: the task it belongs to. The list holds steps and tasks together (see task-steps.ts). */
  parentTaskId: string | null;
  /** The bot's note on what is done, where it stopped and what comes next. */
  progress: string;
  followUp: TaskFollowUp;
  followUpReason: string | null;
  nextCheckAt: string | null;
  checks: number;
  createdAt: string;
  updatedAt: string;
};

export const tasksApi = {
  get: (id: string) => call<{ task: Task }>(`/api/tasks/${id}`).then((r) => r.task),
  list: () => call<{ tasks: Task[] }>("/api/tasks").then((r) => r.tasks),
  create: (title: string, status?: TaskStatus, parentTaskId?: string) =>
    call<{ task: Task }>("/api/tasks", "POST", { title, status, parentTaskId }).then((r) => r.task),
  move: (id: string, status: TaskStatus) =>
    call<{ task: Task }>(`/api/tasks/${id}`, "PATCH", { status }).then((r) => r.task),
  update: (
    id: string,
    patch: {
      title?: string;
      description?: string;
      priority?: TaskPriority;
      labels?: string[];
      /** "auto" resumes a paused follow-up; "off" stops it. */
      followUp?: "auto" | "off";
    },
  ) => call<{ task: Task }>(`/api/tasks/${id}`, "PATCH", patch).then((r) => r.task),
  remove: (id: string) => call(`/api/tasks/${id}`, "DELETE"),
};

/**
 * The board filters on the client, so one list key serves every filter in the URL. The cache holds steps and tasks together; `list`
 * gives the tasks only, and a view that needs the steps or their counts reads the same cache with another `select`.
 */
export const tasksQueries = {
  list: () =>
    queryOptions({ queryKey: ["tasks"], queryFn: () => tasksApi.list(), select: topLevel }),
  detail: (id: string) =>
    queryOptions({ queryKey: ["tasks", id], queryFn: () => tasksApi.get(id) }),
};

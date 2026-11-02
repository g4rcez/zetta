import { call } from "../chat/chat-client";

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
export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  botId: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const tasksApi = {
  get: (id: string) => call<{ task: Task }>(`/api/tasks/${id}`).then((r) => r.task),
  list: () => call<{ tasks: Task[] }>("/api/tasks").then((r) => r.tasks),
  create: (title: string, status?: TaskStatus) =>
    call<{ task: Task }>("/api/tasks", "POST", { title, status }).then((r) => r.task),
  move: (id: string, status: TaskStatus) =>
    call<{ task: Task }>(`/api/tasks/${id}`, "PATCH", { status }).then((r) => r.task),
  update: (
    id: string,
    patch: { title?: string; description?: string; priority?: TaskPriority; labels?: string[] },
  ) => call<{ task: Task }>(`/api/tasks/${id}`, "PATCH", patch).then((r) => r.task),
  remove: (id: string) => call(`/api/tasks/${id}`, "DELETE"),
};

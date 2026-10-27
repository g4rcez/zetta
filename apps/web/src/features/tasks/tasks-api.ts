import { call } from "../chat/chat-client";

export const TASK_COLUMNS = [
  { status: "backlog", label: "Backlog" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
] as const;
export type TaskStatus = (typeof TASK_COLUMNS)[number]["status"];
export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  botId: string | null;
  conversationId: string | null;
  updatedAt: string;
};

export const tasksApi = {
  list: () => call<{ tasks: Task[] }>("/api/tasks").then((r) => r.tasks),
  create: (title: string) =>
    call<{ task: Task }>("/api/tasks", "POST", { title }).then((r) => r.task),
  move: (id: string, status: TaskStatus) =>
    call<{ task: Task }>(`/api/tasks/${id}`, "PATCH", { status }).then((r) => r.task),
  remove: (id: string) => call(`/api/tasks/${id}`, "DELETE"),
};

import type { ProjectHealth } from "@zetta/core/projects";
import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";
import type { Task, TaskStatus } from "../tasks/tasks-api";

export const PROJECT_STATUSES = [
  { status: "active", label: "Active" },
  { status: "paused", label: "On hold" },
  { status: "done", label: "Done" },
  { status: "archived", label: "Archived" },
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["status"];

/** How soon the manager hears about work that stopped moving. */
export const PROJECT_WATCH = [
  {
    watch: "close",
    label: "Closely",
    hint: "You hear about stopped work twice as fast.",
  },
  { watch: "normal", label: "Normally", hint: "The usual waiting times." },
  {
    watch: "light",
    label: "Lightly",
    hint: "You hear only when someone is blocked or asks. Nobody is checked on.",
  },
] as const;
export type ProjectWatch = (typeof PROJECT_WATCH)[number]["watch"];

/** The four answers of the brief, in the order the form asks them, with the question a manager reads. */
export const BRIEF_FIELDS = [
  {
    key: "outcome",
    question: "What should exist when this is done?",
    placeholder: "A launch page and an email to our customers",
  },
  { key: "audience", question: "Who is it for?", placeholder: "People who signed up this year" },
  {
    key: "doneWhen",
    question: "How will we know it is done?",
    placeholder: "The page is live and the email was sent",
  },
  {
    key: "notIncluded",
    question: "What is not included?",
    placeholder: "Paid ads, a new logo",
  },
] as const;
export type BriefKey = (typeof BRIEF_FIELDS)[number]["key"];
export type Brief = Record<BriefKey, string>;
export const BRIEF_MAX = 1000;
export const EMPTY_BRIEF: Brief = { outcome: "", audience: "", doneWhen: "", notIncluded: "" };

export type ProjectCounts = Record<TaskStatus, number> & { total: number };
export type ProjectBot = { id: string; name: string };
/** `avatar` and `title` come with the people a project can take (its candidates); a project's own member list holds the name only. */
export type ProjectPerson = {
  userId: string;
  name: string;
  avatar?: unknown;
  title?: string;
};

/** A project as the list shows it. `role` is who is reading: the owner manages it, a member only reads. */
export type Project = Brief & {
  id: string;
  name: string;
  labels: string[];
  status: ProjectStatus;
  watch: ProjectWatch;
  role: "owner" | "member";
  bots: ProjectBot[];
  people: ProjectPerson[];
  counts: ProjectCounts;
  health: ProjectHealth;
  createdAt: string;
  updatedAt: string;
};
export type ProjectTask = Pick<
  Task,
  | "id"
  | "title"
  | "status"
  | "priority"
  | "assignee"
  | "assigneeUserId"
  | "assigneeName"
  | "botId"
  | "progress"
  | "followUp"
  | "updatedAt"
> & {
  stepsDone: number;
  stepsTotal: number;
  /** Whether the reader may open the task page (the owner, or the person it is assigned to). */
  canOpen: boolean;
  /** Whether the reader can write to whoever does the task. */
  canTell: boolean;
};
/** Why a task waits on the manager. "card": a card in the Inbox says so; the others are read from the task itself. */
export type NeedsYouWhy = "card" | "blocked" | "review";
export type NeedsYou = {
  taskId: string;
  title: string;
  why: NeedsYouWhy;
  text: string;
  cardId: string | null;
  kind: string | null;
  botId: string | null;
  assigneeName: string | null;
};
export type ProjectRoom = {
  id: string;
  title: string;
  status: string;
  progressPercent: number | null;
  progressNote: string;
};
/** An item of the project's memory: what its bots wrote down for each other. */
export type ProjectNote = { slug: string; title: string; howto: string; updatedAt: string };
export type ProjectDetail = Project & {
  tasks: ProjectTask[];
  shipped: ProjectTask[];
  needsYou: NeedsYou[];
  rooms: ProjectRoom[];
  memory: { items: ProjectNote[]; total: number };
};
export type Candidates = {
  bots: ProjectBot[];
  people: ProjectPerson[];
  rooms: { id: string; title: string; projectId: string | null }[];
};
export type Unfiled = { total: number; open: number };
export type DraftResult = { kind: "ok"; value: Brief } | { kind: "unavailable"; reason: string };
export type WorkTarget = { kind: "bot" | "person"; id: string };

type One = { project: ProjectDetail };
export type ProjectPatch = Partial<Brief> & {
  name?: string;
  labels?: string[];
  status?: ProjectStatus;
  watch?: ProjectWatch;
};

export const projectsApi = {
  list: () => call<{ projects: Project[]; unfiled: Unfiled }>("/api/projects"),
  get: (id: string) => call<One>(`/api/projects/${id}`).then((r) => r.project),
  candidates: () => call<Candidates>("/api/projects/candidates"),
  create: (v: { name: string; bots: string[]; people: string[] } & Partial<Brief>) =>
    call<One>("/api/projects", "POST", v).then((r) => r.project),
  update: (id: string, patch: ProjectPatch) =>
    call<One>(`/api/projects/${id}`, "PATCH", patch).then((r) => r.project),
  setMembers: (id: string, v: { bots: string[]; people: string[] }) =>
    call<One>(`/api/projects/${id}/members`, "PUT", v).then((r) => r.project),
  setRooms: (id: string, rooms: string[]) =>
    call<One>(`/api/projects/${id}/rooms`, "PUT", { rooms }).then((r) => r.project),
  draft: (name: string, sentence: string) =>
    call<DraftResult>("/api/projects/draft", "POST", { name, sentence }),
  /** Asks a bot or a person of the project for something. The task exists when this returns. */
  ask: (id: string, to: WorkTarget, text: string) =>
    call<{ task: { id: string; title: string }; conversationId: string | null }>(
      `/api/projects/${id}/work`,
      "POST",
      { to, text },
    ),
};

/** Everything lives under ["projects"]: the `projects` and `tasks` live topics both refresh it. */
export const projectsQueries = {
  list: () => queryOptions({ queryKey: ["projects"], queryFn: () => projectsApi.list() }),
  detail: (id: string) =>
    queryOptions({ queryKey: ["projects", id], queryFn: () => projectsApi.get(id) }),
  candidates: () =>
    queryOptions({
      queryKey: ["projects", "candidates"],
      queryFn: () => projectsApi.candidates(),
    }),
};

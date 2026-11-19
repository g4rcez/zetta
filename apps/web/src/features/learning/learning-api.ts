import { queryOptions } from "@tanstack/react-query";
import type { UsefulnessLabel } from "@zetta/core/learning";

import { call } from "../chat/chat-client";

export type { UsefulnessLabel };
export type ItemKind = "memory" | "skill";
export type UsefulnessSort = "worst" | "best" | "uses" | "recent" | "name";

/** One memory item or skill with what happened after the replies that used it (modules/learning/usefulness.ts). */
export type UsefulnessRow = {
  kind: ItemKind;
  id: string;
  /** The slug of a memory item, the name of a skill. */
  slug: string;
  title: string;
  howto: string;
  tags: string[];
  /** A memory item's type (who reads it) or a skill's source. */
  source: string;
  status: string;
  uses: number;
  good: number;
  bad: number;
  ambient: number;
  lastUsedAt: string | null;
  label: UsefulnessLabel;
  /** A sentence that says why it has this label. */
  reason: string;
};

export type UsefulnessAnswer = {
  windowDays: number;
  /** How often the person stepped in after this bot's replies in general, or null when there is not enough to say. */
  baselineBadRate: number | null;
  counts: Record<UsefulnessLabel, number>;
  total: number;
  rows: UsefulnessRow[];
};

export type UsefulnessFilters = {
  bot?: string | undefined;
  kind?: ItemKind | undefined;
  label?: UsefulnessLabel | undefined;
  sort?: UsefulnessSort | undefined;
  find?: string | undefined;
  view?: "archived" | undefined;
};

export type ItemRef = { kind: ItemKind; id: string };
export type BulkResult = { done: number; failed: { id: string; reason: string }[] };

const params = (f: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export type LessonStatus = "candidate" | "trial" | "kept" | "dropped" | "rejected" | "expired";
export type LessonView = {
  id: string;
  botId: string;
  text: string;
  topic: string;
  kind: "rule" | "procedure";
  scope: "topic" | "always";
  status: LessonStatus;
  /** Why it passed the checks; null for a candidate that waits for a second sighting. */
  basis: "said" | "repeated" | "person" | "old" | null;
  origin: string;
  dropReason: "bad_results" | "unused" | "person" | "superseded" | "duplicate" | null;
  memorySlug: string | null;
  skillName: string | null;
  createdAt: string;
  updatedAt: string;
  /** The person's own words that taught it, newest first. */
  evidence: { quote: string; day: string; conversationId: string | null }[];
  seen: { chats: number; days: number };
  events: { kind: string; by: "system" | "person"; detail: string; at: string }[];
  /** How the lessons did, for one that is (or was) in use. */
  results: {
    uses: number;
    good: number;
    bad: number;
    label: UsefulnessLabel;
    reason: string;
    lastUsedAt: string | null;
  } | null;
};
export type LessonsFilter = {
  bot?: string | undefined;
  status?: "waiting" | "trial" | "kept" | "dropped" | "all" | undefined;
};
export type LearningRun = {
  id: string;
  trigger: "daily" | "manual";
  status: "running" | "done" | "skipped" | "failed";
  detail: string;
  candidates: number;
  promoted: number;
  startedAt: string;
  finishedAt: string | null;
};
export type BotLearning = {
  bot: { id: string; name: string; autoLearn: "auto" | "suggest" | "off" };
  runs: LearningRun[];
  /** "Run now" is open again at this time; null when it is open. */
  runNowAfter: string | null;
};
export type LearningPolicy = {
  batch: "daily" | "off";
  forget: "on" | "off";
  tidy: "weekly" | "off";
  strictness: "strict" | "normal" | "loose";
};
export type LessonAction = "accept" | "reject" | "keep" | "drop" | "restore";
/** One week of a bot's trend: how often the person had to step in, and the lessons that changed in it. */
export type ProgressWeek = {
  start: string;
  replies: number;
  stepIns: number;
  per100: number | null;
  started: number;
  kept: number;
  dropped: number;
};
export type ProgressSide = { replies: number; stepIns: number; per100: number };
export type BotProgress = {
  weeks: ProgressWeek[];
  recent: ProgressSide | null;
  earlier: ProgressSide | null;
  lessons: { trial: number; kept: number; dropped: number; waiting: number };
};
export type FindingKind =
  | "duplicate"
  | "check_pair"
  | "superseded_current"
  | "unused"
  | "drop_kept";
/** A suggestion of the tidy-up. Nothing changes until the person accepts it. */
export type Finding = {
  id: string;
  kind: FindingKind;
  botId: string | null;
  summary: string;
  status: "open" | "accepted" | "dismissed" | "outdated";
  createdAt: string;
  refs: { kind: "lesson" | "memory"; id: string; label: string; slug: string | null }[];
};

export const learningApi = {
  lessons: (f: LessonsFilter) =>
    call<{ lessons: LessonView[] }>(`/api/lessons${params(f)}`).then((r) => r.lessons),
  act: (id: string, action: LessonAction) =>
    call<{ lesson: LessonView }>(`/api/lessons/${id}/${action}`, "POST").then((r) => r.lesson),
  edit: (id: string, text: string) =>
    call<{ lesson: LessonView }>(`/api/lessons/${id}`, "PATCH", { text }).then((r) => r.lesson),
  overview: (botId: string) => call<BotLearning>(`/api/bots/${botId}/learning`),
  runNow: (botId: string) =>
    call<{ run: LearningRun }>(`/api/bots/${botId}/learning/run`, "POST").then((r) => r.run),
  addWeeklyCheck: () =>
    call<{ id: string; created: boolean }>("/api/learning/workflow-template", "POST"),
  progress: (botId: string) => call<BotProgress>(`/api/bots/${botId}/learning/progress`),
  findings: (status: "open" | "accepted" | "dismissed" | "all" = "open") =>
    call<{ findings: Finding[] }>(`/api/learning/findings?status=${status}`).then(
      (r) => r.findings,
    ),
  acceptFinding: (id: string, drop?: string) =>
    call<{ id: string; status: string }>(
      `/api/learning/findings/${id}/accept`,
      "POST",
      drop ? { drop } : {},
    ),
  dismissFinding: (id: string) =>
    call<{ id: string; status: string }>(`/api/learning/findings/${id}/dismiss`, "POST"),
  policy: () => call<{ policy: LearningPolicy }>("/api/learning/policy").then((r) => r.policy),
  setPolicy: (patch: Partial<LearningPolicy>) =>
    call<{ policy: LearningPolicy }>("/api/learning/policy", "PUT", patch).then((r) => r.policy),
  usefulness: (filters: UsefulnessFilters) =>
    call<UsefulnessAnswer>(`/api/learning/usefulness${params(filters)}`),
  archive: (items: ItemRef[]) => call<BulkResult>("/api/learning/archive", "POST", { items }),
  restore: (items: ItemRef[]) => call<BulkResult>("/api/learning/restore", "POST", { items }),
};

export const learningQueries = {
  lessons: (f: LessonsFilter) =>
    queryOptions({ queryKey: ["learning", "lessons", f], queryFn: () => learningApi.lessons(f) }),
  overview: (botId: string) =>
    queryOptions({
      queryKey: ["learning", "bot", botId],
      queryFn: () => learningApi.overview(botId),
      // While a reading is going on the page asks again, in case the live update does not arrive.
      refetchInterval: (q) => (q.state.data?.runs[0]?.status === "running" ? 3000 : false),
    }),
  progress: (botId: string) =>
    queryOptions({
      queryKey: ["learning", "progress", botId],
      queryFn: () => learningApi.progress(botId),
    }),
  findings: (status: "open" | "accepted" | "dismissed" | "all" = "open") =>
    queryOptions({
      queryKey: ["learning", "findings", status],
      queryFn: () => learningApi.findings(status),
    }),
  policy: () =>
    queryOptions({ queryKey: ["learning", "policy"], queryFn: () => learningApi.policy() }),
  usefulness: (filters: UsefulnessFilters) =>
    queryOptions({
      queryKey: ["learning", "usefulness", filters],
      queryFn: () => learningApi.usefulness(filters),
    }),
};

import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";
import { looksLikeSource } from "./source";

export type SkillSource = "manual" | "github";
/** A file next to a skill's SKILL.md. `path` is relative to the skill folder. */
export type SkillFile = { path: string; size: number; mode: "file" | "executable" };
export type Skill = {
  id: string;
  ownerUserId: string;
  ownerName: string;
  name: string;
  description: string;
  source: SkillSource;
  sourceRepo: string | null;
  sourcePath: string | null;
  sourceRef: string | null;
  version: number;
  status: "active" | "archived";
  /** Size of the text in bytes. */
  bodyBytes: number;
  /** When a bot last used it (picked with `/` or loaded by a run), and how many times in the last 30 days. */
  lastUsedAt: string | null;
  uses30d: number;
  /** `pending`: installed before folders were kept; the server is still to download the other files from GitHub. */
  filesStatus: "complete" | "pending";
  createdAt: string;
  updatedAt: string;
  /** Bots that bring this skill to their harness. */
  botIds: string[];
  /** How many files sit next to the SKILL.md. Only the list has it; `get` returns the files themselves. */
  fileCount?: number;
};
export type SkillWithText = Skill & { body: string; files: SkillFile[] };
export type SkillDraft = { name: string; description: string; body: string };

export type SkillWarning =
  | "empty"
  | "too_large"
  | "files_too_large"
  | "file_looks_secret"
  | "shell_injection"
  | "looks_secret"
  | "invalid_name";
export const WARNING_TEXT: Record<SkillWarning, string> = {
  empty: "The file has no instructions.",
  too_large: "It is larger than 64 KB, the limit for a skill.",
  files_too_large:
    "Its other files are too large: over 1 MB for one file, 200 files or 4 MB in all.",
  file_looks_secret: "One of its files looks like it holds a key or a password.",
  shell_injection: "It runs shell commands when it loads (!`...`), which is not allowed.",
  looks_secret: "It looks like it holds a key or a password.",
  invalid_name: "Its folder name is not a valid skill name.",
};
export type Trust = "official" | "trusted";
export type Suggestion = { repo: string; blurb: string; trust: Trust };
/** A skill found in a repository or by search; `repo` and `trust` are set for search results. */
export type MarketSkill = {
  name: string;
  path: string;
  description: string;
  warnings: SkillWarning[];
  /** The files next to the SKILL.md. */
  files: { count: number; bytes: number };
  installedId: string | null;
};
export type MarketRepo = {
  repo: string;
  ref: string;
  truncated: boolean;
  /** Null when the repository is not on the trusted list. */
  trust: Trust | null;
  skills: MarketSkill[];
};
export type SearchHit = MarketSkill & { repo: string; ref: string; trust: Trust };
export type SearchResult = { skills: SearchHit[]; unavailable: string[]; indexing: boolean };
export type InstallResult = {
  installed: (Skill & { botIds: string[] })[];
  /** Skills that were already installed and were given to more bots. */
  attached: { id: string; name: string; botIds: string[] }[];
  failed: { path: string; code: string }[];
  attachError: string | null;
};
/** What a skill that could not be installed says to the person. */
export const FAILURE_TEXT: Record<string, string> = {
  INSTALLED: "is already installed: choose a bot to bring it to",
  UNINSTALLABLE: "cannot be installed",
  DUPLICATE: "you already have a skill with this name",
  FULL: "you reached the limit of skills",
  SECRET_REJECTED: "looks like it holds a secret",
  NOT_FOUND: "was not found on GitHub",
  RATE_LIMITED: "GitHub's rate limit was reached",
};

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** The filters of My skills, as the address holds them (see skills-search.ts). */
export type SkillListFilters = {
  find?: string | undefined;
  source?: "github" | "manual" | undefined;
  sort?: "name" | "used" | "size" | undefined;
  bot?: string | undefined;
  view?: "archived" | undefined;
  use?: "unused" | undefined;
};
const listParams = (scope: "mine" | "all", f: SkillListFilters) =>
  q({
    scope,
    ...(f.find && { q: f.find }),
    ...(f.source && { source: f.source }),
    ...(f.sort && { sort: f.sort }),
    ...(f.bot && { bot: f.bot }),
    ...(f.view && { status: f.view }),
    ...(f.use && { unused: "yes" }),
  });
/** What saving a draft would say, without saving (see modules/skills/service.ts `check`). */
export type SkillCheck = {
  problems: string[];
  warnings: string[];
  bodyBytes: number;
  hermesBytes: number;
  similar: { id: string; name: string; description: string; why: "name" | "topic" }[];
};
/** What the update check says about one skill installed from GitHub (see modules/skills/install.ts). */
export type SkillUpdate = {
  id: string;
  name: string;
  repo: string;
  installedRef: string;
  latestRef: string;
  state: "update" | "current" | "gone" | "unknown";
  /** The owner changed it after installing: updating replaces their changes. */
  edited: boolean;
};
/** One save of a skill (create, edit, restore). */
export type SkillRevisionRow = {
  id: string;
  version: number;
  name: string;
  description: string;
  bodyBytes: number;
  filesHash: string;
  savedBy: string;
  createdAt: string;
};
export type SkillHistory = { currentVersion: number; revisions: SkillRevisionRow[] };
export type SkillRevision = {
  id: string;
  version: number;
  name: string;
  description: string;
  body: string;
  filesHash: string;
  createdAt: string;
};
/** One skill of a bot, from any place (see modules/skills/overview.ts). */
export type SkillOverviewRow = {
  name: string;
  description: string;
  source: "library" | "bot" | "builtin" | "host";
  skillId: string | null;
  bytes: number | null;
  hiddenBy: "bot" | null;
  unusable: boolean;
  fits: boolean | null;
};
export type SkillOverview = {
  harness: string;
  budget: { used: number; limit: number; dropped: number } | null;
  skills: SkillOverviewRow[];
};

export const skillsApi = {
  list: (scope: "mine" | "all", filters: SkillListFilters = {}) =>
    call<{ skills: Skill[] }>(`/api/skills?${listParams(scope, filters)}`).then((r) => r.skills),
  history: (id: string) =>
    call<{ history: SkillHistory }>(`/api/skills/${id}/history`).then((r) => r.history),
  revision: (id: string, revisionId: string) =>
    call<{ revision: SkillRevision }>(`/api/skills/${id}/revisions/${revisionId}`).then(
      (r) => r.revision,
    ),
  revert: (id: string, revisionId: string, expectedVersion: number) =>
    call<{ skill: SkillWithText }>(`/api/skills/${id}/revert`, "POST", {
      revisionId,
      expectedVersion,
    }).then((r) => r.skill),
  updates: () => call<{ updates: SkillUpdate[] }>("/api/skills/updates").then((r) => r.updates),
  updateFromSource: (id: string, ref: string, overwriteEdited: boolean) =>
    call<{ skill: SkillWithText }>(`/api/skills/${id}/update`, "POST", {
      ref,
      ...(overwriteEdited && { overwriteEdited: "yes" }),
    }).then((r) => r.skill),
  check: (draft: Partial<SkillDraft> & { skillId?: string }) =>
    call<{ check: SkillCheck }>("/api/skills/check", "POST", draft).then((r) => r.check),
  /** One file of the folder: text as text, anything else as base64. */
  file: (id: string, path: string) =>
    call<{
      file: {
        path: string;
        mode: "file" | "executable";
        size: number;
        encoding: "utf8" | "base64";
        content: string;
      };
    }>(`/api/skills/${id}/file?${q({ path })}`).then((r) => r.file),
  putFiles: (
    id: string,
    files: {
      path: string;
      content: string;
      encoding?: "utf8" | "base64";
      mode?: "file" | "executable";
    }[],
  ) =>
    call<{ files: SkillFile[] }>(`/api/skills/${id}/files`, "PUT", { files }).then((r) => r.files),
  removeFiles: (id: string, paths: string[]) =>
    call<{ files: SkillFile[] }>(`/api/skills/${id}/files/remove`, "POST", { paths }).then(
      (r) => r.files,
    ),
  restore: (id: string) =>
    call<{ skill: SkillWithText }>(`/api/skills/${id}/restore`, "POST").then((r) => r.skill),
  bulk: (input: {
    action: "attach" | "detach" | "archive";
    skillIds: string[];
    botIds?: string[];
  }) => call<{ changed: number; skippedBots: string[] }>("/api/skills/bulk", "POST", input),
  overview: (botId: string) =>
    call<{ overview: SkillOverview }>(`/api/bots/${botId}/skills/overview`).then((r) => r.overview),
  get: (id: string) => call<{ skill: SkillWithText }>(`/api/skills/${id}`).then((r) => r.skill),
  create: (draft: SkillDraft) =>
    call<{ skill: SkillWithText }>("/api/skills", "POST", draft).then((r) => r.skill),
  update: (id: string, expectedVersion: number, draft: Partial<SkillDraft>) =>
    call<{ skill: SkillWithText }>(`/api/skills/${id}`, "PATCH", {
      expectedVersion,
      ...draft,
    }).then((r) => r.skill),
  archive: (id: string) => call(`/api/skills/${id}`, "DELETE"),
  setBots: (id: string, botIds: string[]) =>
    call<{ botIds: string[] }>(`/api/skills/${id}/bots`, "PUT", { botIds }),
  suggestions: () =>
    call<{ suggestions: Suggestion[] }>("/api/skills/market/suggestions").then(
      (r) => r.suggestions,
    ),
  search: (query: string) => call<SearchResult>(`/api/skills/market/search?${q({ q: query })}`),
  repo: (source: string) => call<MarketRepo>(`/api/skills/market/repo?${q({ source })}`),
  install: (input: { source: string; sha: string; paths: string[]; botIds: string[] }) =>
    call<InstallResult>("/api/skills/market/install", "POST", input),
};

/** A skill name from free text: lowercase letters, numbers and dashes, starting with a letter. */
export const toSkillName = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 63);

/** What the marketplace shows for the text in the address: a repository to browse, or the result of a search. */
export type MarketAnswer =
  | { kind: "repo"; repo: MarketRepo }
  | { kind: "search"; text: string; result: SearchResult };

/** Keys nest under `["skills"]`: `list` is the library, `market` is GitHub. */
export const skillsQueries = {
  list: (scope: "mine" | "all", filters: SkillListFilters = {}) =>
    queryOptions({
      queryKey: ["skills", "list", scope, filters],
      queryFn: () => skillsApi.list(scope, filters),
    }),
  history: (id: string) =>
    queryOptions({ queryKey: ["skills", "history", id], queryFn: () => skillsApi.history(id) }),
  overview: (botId: string) =>
    queryOptions({
      queryKey: ["skills", "overview", botId],
      queryFn: () => skillsApi.overview(botId),
    }),
  suggestions: () =>
    queryOptions({
      queryKey: ["skills", "market", "suggestions"],
      queryFn: () => skillsApi.suggestions(),
    }),
  /** `text` is the submitted text (`q` in the address). */
  market: (text: string) =>
    queryOptions({
      queryKey: ["skills", "market", "source", text],
      queryFn: async (): Promise<MarketAnswer> =>
        looksLikeSource(text)
          ? { kind: "repo", repo: await skillsApi.repo(text) }
          : { kind: "search", text, result: await skillsApi.search(text) },
    }),
};

import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";
import { looksLikeSource } from "./source";

export type SkillSource = "manual" | "github";
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
  createdAt: string;
  updatedAt: string;
  /** Bots that bring this skill to their harness. */
  botIds: string[];
};
export type SkillWithText = Skill & { body: string };
export type SkillDraft = { name: string; description: string; body: string };

export type SkillWarning =
  | "empty"
  | "too_large"
  | "shell_injection"
  | "looks_secret"
  | "invalid_name";
export const WARNING_TEXT: Record<SkillWarning, string> = {
  empty: "The file has no instructions.",
  too_large: "It is larger than 24 KB, the limit for a skill.",
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

export const skillsApi = {
  list: (scope: "mine" | "all") =>
    call<{ skills: Skill[] }>(`/api/skills?scope=${scope}`).then((r) => r.skills),
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
  list: (scope: "mine" | "all") =>
    queryOptions({ queryKey: ["skills", "list", scope], queryFn: () => skillsApi.list(scope) }),
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

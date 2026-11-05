import { queryOptions } from "@tanstack/react-query";

import type { AvatarValue } from "@/components/bot-avatar";
import { ApiError, call, errorMessage } from "../chat/chat-client";
import type { GraphData } from "./wiki-graph";

export type Status = "current" | "stale" | "archived";
export type WikiType = "solo" | "owner" | "teams" | "all";
export type Relation = "related" | "depends-on" | "part-of" | "supersedes";
export type Link = { slug: string; title: string; relation: Relation };
/** A bot as `/api/bots` returns it; the avatar is there so every mention of a bot can show who it is. */
export type Bot = {
  id: string;
  name: string;
  avatar?: AvatarValue | null;
  kind?: "chief" | "specialist";
};
export type TeamName = { id: string; name: string };
export type Author = "user" | "bot" | "system";

/** One of the person's own items, as the list returns it (no content). */
export type Row = {
  id: string;
  slug: string;
  title: string;
  type: WikiType;
  howto: string;
  tags: string[];
  score: number;
  status: Status;
  version: number;
  authorBotId: string | null;
  updatedByBotId: string | null;
  teams: string[];
  updatedBy: Author;
  createdAt: string;
  updatedAt: string;
};
/** An item another member published. */
export type SharedRow = {
  id: string;
  slug: string;
  title: string;
  type: WikiType;
  howto: string;
  tags: string[];
  score: number;
  status: Status;
  version: number;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
};
/** Own and shared items in one shape, for filtering and sorting. */
export type Item = {
  id: string;
  slug: string;
  title: string;
  type: WikiType;
  howto: string;
  tags: string[];
  score: number;
  status: Status;
  access: "own" | "shared";
  /** Who wrote the last version; shared items only know their owner. */
  by: Author | null;
  ownerName: string | null;
  botId: string | null;
  /** The bot that created the item; null when a person or the system did. */
  authorBotId: string | null;
  teams: string[];
  createdAt: string;
  updatedAt: string;
  /** Set on a search result: why it matched, and the items linked to it. */
  why?: Why;
  neighbors?: { relation: Relation; direction: "out" | "in"; slug: string; title: string }[];
};
/** Which rankings found a search result. `passage` marks the matching words with \u0001 and \u0002. */
export type Why = { keyword: boolean; tags: string[]; meaning: boolean; passage: string };
/** One result of GET /api/wiki?q=… */
export type Hit = {
  id: string;
  slug: string;
  title: string;
  type: WikiType;
  howto: string;
  tags: string[];
  score: number;
  status: Status;
  access: "own" | "shared";
  ownerName: string | null;
  updatedAt: string;
  why: Why;
  neighbors: NonNullable<Item["neighbors"]>;
};
export type Page = Omit<Row, "updatedByBotId"> & { content: string; updatedByBotId: string | null };
export type Source = {
  kind: "task" | "doc" | "artifact" | "url";
  ref: string;
  label: string;
  status: "current" | "changed" | "gone";
  checkedAt: string;
};
export type Version = {
  version: number;
  title: string;
  status: Status;
  author: Author;
  botId: string | null;
  createdAt: string;
};
export type Detail =
  | {
      access: "own";
      page: Page;
      linkedFrom: Link[];
      links: Link[];
      history: Version[];
      sources: Source[];
    }
  | { access: "shared"; ownerName: string; page: Page; linkedFrom: Link[]; links: Link[] };
export type Suggestions = {
  incoming: {
    id: string;
    slug: string;
    pageTitle: string;
    currentContent: string;
    pageVersion: number;
    title: string;
    content: string;
    reason: string;
    baseVersion: number;
    authorName: string;
    createdAt: string;
  }[];
  outgoing: {
    id: string;
    slug: string;
    pageTitle: string;
    status: string;
    reason: string;
    createdAt: string;
  }[];
};
export type Brief = { slug: string; title: string };
/** What a review job works on: every check, or one group. */
export type Problem = "all" | "brokenLinks" | "unlinked" | "old" | "stale" | "unsourced";
export type Checks = {
  checks: {
    brokenLinks: { slug: string; target: string }[];
    unlinked: Brief[];
    old: Brief[];
    stale: Brief[];
    unsourced: Brief[];
    openSuggestions: number;
  };
  jobs: {
    id: string;
    kind: "learn" | "review";
    source: string;
    status: string;
    result: string;
    /** A review: the group it works on. The chat of a review is `conversationId`; no chat list shows it. */
    problem: Problem;
    conversationId: string | null;
    botId: string | null;
    botName: string | null;
    createdAt: string;
  }[];
};

/** Who reads an item. "all" is set with the Share button, never in the form. */
export const TYPE = {
  solo: "One bot",
  owner: "All my bots",
  teams: "Teams",
  all: "Shared",
} as const satisfies Record<WikiType, string>;
export const RELATION: Record<Relation, string> = {
  related: "Related",
  "depends-on": "Depends on",
  "part-of": "Part of",
  supersedes: "Supersedes",
};
export const STATUS: Record<Status, string> = {
  current: "Current",
  stale: "Stale",
  archived: "Archived",
};
export const SOURCE = {
  task: "Task",
  doc: "Document",
  artifact: "Artifact",
  url: "Web page",
} as const;

export const path = (slug: string) => `/api/wiki/${encodeURIComponent(slug)}`;

export function wikiError(e: unknown) {
  if (e instanceof ApiError && e.code === "CONFLICT")
    return "This item changed somewhere else. It was reloaded; make your change again.";
  return errorMessage(e);
}

/** Saves a new item from a form; the server makes the slug from the title and version 0 refuses to overwrite an item with that name. */
export async function createItem(body: { title: string } & Record<string, unknown>) {
  try {
    await call(path(body.title.slice(0, 80)), "PUT", { ...body, expectedVersion: 0 });
  } catch (err) {
    if (err instanceof ApiError && err.code === "CONFLICT")
      throw new Error("An item with this name exists. Open it from the list to change it.");
    throw err;
  }
}

/** What the editor help suggests (POST /api/wiki-assist). Every key is optional; the person accepts each one. */
export type Ask = "tags" | "howto" | "score" | "links" | "tidy";
export type AssistSuggestions = {
  tags?: string[];
  howto?: string;
  score?: { value: number; reason: string };
  links?: { slug: string; title: string; relation: Relation; reason: string }[];
  tidy?: { content: string; summary: string };
};
export type AssistResult =
  | { kind: "ok"; suggestions: AssistSuggestions }
  | { kind: "unavailable"; reason: string };

/** What `/api/wiki/:slug/graph` returns: the items one or two links away. */
export type Neighbors = {
  slug: string;
  nodes: { slug: string; title: string }[];
  edges: { from: string; to: string; relation: Relation }[];
};

/**
 * Every wiki read has one key under `["wiki"]`, so a write invalidates the whole prefix and
 * every screen that shows the wiki (list, item, graph, health) follows.
 */
export const wikiQueries = {
  /** Every item the person can see (own and shared). */
  index: () =>
    queryOptions({
      queryKey: ["wiki", "index"],
      queryFn: () => call<{ pages: Row[]; shared: SharedRow[] }>("/api/wiki"),
    }),
  /** `query` is the search string from the address (see `searchQuery`). */
  search: (query: string) =>
    queryOptions({
      queryKey: ["wiki", "search", query],
      queryFn: () => call<{ pages: Hit[]; meaning: boolean }>(`/api/wiki?${query}`),
    }),
  graph: () =>
    queryOptions({
      queryKey: ["wiki", "graph"],
      queryFn: () => call<GraphData>("/api/wiki-graph"),
    }),
  item: (slug: string) =>
    queryOptions({ queryKey: ["wiki", "item", slug], queryFn: () => call<Detail>(path(slug)) }),
  neighbors: (slug: string, depth: 1 | 2) =>
    queryOptions({
      queryKey: ["wiki", "item", slug, "graph", depth],
      queryFn: () => call<Neighbors>(`${path(slug)}/graph?depth=${depth}`),
    }),
  checks: () =>
    queryOptions({ queryKey: ["wiki", "checks"], queryFn: () => call<Checks>("/api/wiki-checks") }),
  suggestions: () =>
    queryOptions({
      queryKey: ["wiki", "suggestions"],
      queryFn: () => call<Suggestions>("/api/wiki-suggestions"),
    }),
};

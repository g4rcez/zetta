import type { OrgRank, OrgSeat } from "@zetta/core/org";
import { queryOptions } from "@tanstack/react-query";

import { call, type BotAvatarValue } from "../chat/chat-client";

export type { OrgRank, OrgSeat };

export type OrgHolder =
  | { kind: "person"; userId: string; name: string; avatar: unknown; jobTitle?: string }
  | {
      kind: "bot";
      botId: string;
      name: string;
      description: string;
      /** What the bot is for, in a few words. Empty: the seat title tells (see `botRole`). */
      role?: string;
      avatar: BotAvatarValue | null;
    };
/** Why a seat reads as open although somebody was put in it. `mine`: the reader owns that bot. */
export type OrgProblemCode = "member_removed" | "bot_private" | "bot_archived" | "bot_missing";
export type OrgProblem = { code: OrgProblemCode; was: string; mine: boolean };

export type OrgPosition = {
  id: string;
  parentId: string | null;
  rank: OrgRank;
  title: string;
  description: string;
  unit: string;
  sortOrder: number;
  templateKey: string | null;
  seat: OrgSeat;
  holder: OrgHolder | null;
  problem: OrgProblem | null;
  team: { id: string; name: string } | null;
};

export type OrgPalette = {
  people: { userId: string; name: string; avatar: unknown; title?: string }[];
  /** Bots shared with the team, and the admin's own private ones (a private bot is shared when the admin seats it). */
  bots: {
    id: string;
    name: string;
    description: string;
    avatar: BotAvatarValue | null;
    visibility: "private" | "team";
  }[];
  teams: { id: string; name: string }[];
};

export type OrgView = {
  /** `id` is null before the first edit; `version` is 0 then. */
  chart: { id: string | null; name: string; version: number };
  positions: OrgPosition[];
  canEdit: boolean;
  /** Only the admin gets it. */
  palette: OrgPalette | null;
};

/** `team`: a private bot picked for a seat is shared with the team in the same step. */
export type OrgShareBot = "team";

export type OrgCreate = {
  parentId?: string | null;
  templateKey?: string;
  title?: string;
  description?: string;
  unit?: string;
  rank?: OrgRank;
  /** Who holds the new seat, written with the seat itself. */
  holder?: OrgHolderInput;
  shareBot?: OrgShareBot;
};
export type OrgUpdate = {
  title?: string;
  description?: string;
  unit?: string;
  rank?: OrgRank;
  teamId?: string | null;
};
export type OrgHolderInput =
  | { kind: "open" }
  | { kind: "person"; userId: string }
  | { kind: "bot"; botId: string };

/** Why a bot of a team got no seat in the draft. */
export type OrgDraftSkipReason =
  | "private"
  | "archived"
  | "chief_of_staff"
  | "already_seated"
  | "too_many";
export type OrgDraftSeat = {
  ref: number;
  parentRef: number | null;
  rank: OrgRank;
  title: string;
  description: string;
  unit: string;
  team: { id: string; name: string } | null;
  holder: { botId: string; name: string } | null;
  note: string | null;
};
/** A first chart drafted from the admin's teams. Nothing is saved until the admin confirms it. */
export type OrgDraft = {
  seats: OrgDraftSeat[];
  skipped: { botId: string; name: string; teamName: string; reason: OrgDraftSkipReason }[];
  teams: { id: string; name: string; botCount: number }[];
};
/** What the admin leaves out of the draft before saving it. */
export type OrgDraftChoices = { skipTeamIds: string[]; skipBotIds: string[] };

export const ORG_LINK_KINDS = ["room", "workflow", "handoff"] as const;
export type OrgLinkKind = (typeof ORG_LINK_KINDS)[number];
/** Two bots of the chart that work together: `aId` and `bId` are bot ids. */
export type OrgLink = {
  aId: string;
  bId: string;
  weight: number;
  kinds: OrgLinkKind[];
  counts: Record<OrgLinkKind, number>;
};

const org = (r: { org: OrgView }) => r.org;
const body = (expectedVersion: number, v: object = {}) => ({ expectedVersion, ...v });

/** Every write names the version of the chart the person saw; the server refuses it when somebody changed the chart since. */
export const orgApi = {
  get: () => call<{ org: OrgView }>("/api/org").then(org),
  create: (version: number, v: OrgCreate) =>
    call<{ org: OrgView }>("/api/org/positions", "POST", body(version, v)).then(org),
  update: (version: number, id: string, v: OrgUpdate) =>
    call<{ org: OrgView }>(`/api/org/positions/${id}`, "PATCH", body(version, v)).then(org),
  move: (version: number, id: string, parentId: string, index?: number) =>
    call<{ org: OrgView }>(
      `/api/org/positions/${id}/move`,
      "POST",
      body(version, { parentId, ...(index !== undefined && { index }) }),
    ).then(org),
  seat: (version: number, id: string, holder: OrgHolderInput, shareBot?: OrgShareBot) =>
    call<{ org: OrgView }>(
      `/api/org/positions/${id}/seat`,
      "PUT",
      body(version, { holder, ...(shareBot && { shareBot }) }),
    ).then(org),
  remove: (version: number, id: string) =>
    call<{ org: OrgView }>(`/api/org/positions/${id}?expectedVersion=${version}`, "DELETE").then(
      org,
    ),
  links: () => call<{ links: OrgLink[] }>("/api/org/links").then((r) => r.links),
  draft: (choices: OrgDraftChoices = { skipTeamIds: [], skipBotIds: [] }) => {
    const q = new URLSearchParams();
    if (choices.skipTeamIds.length) q.set("skipTeamIds", choices.skipTeamIds.join(","));
    if (choices.skipBotIds.length) q.set("skipBotIds", choices.skipBotIds.join(","));
    const query = q.toString();
    return call<{ draft: OrgDraft }>(`/api/org/draft${query ? `?${query}` : ""}`).then(
      (r) => r.draft,
    );
  },
  applyDraft: (version: number, choices: OrgDraftChoices) =>
    call<{ org: OrgView }>("/api/org/draft", "POST", body(version, choices)).then(org),
  applyPreset: (version: number, presetKey: string, underPositionId?: string) =>
    call<{ org: OrgView }>(
      "/api/org/presets",
      "POST",
      body(version, { presetKey, ...(underPositionId && { underPositionId }) }),
    ).then(org),
};

export const orgQueries = {
  get: () => queryOptions({ queryKey: ["org"], queryFn: () => orgApi.get(), staleTime: 30_000 }),
  links: () =>
    queryOptions({ queryKey: ["org", "links"], queryFn: () => orgApi.links(), staleTime: 30_000 }),
  /** The preview is a fresh read every time it opens: teams change. */
  draft: () =>
    queryOptions({
      queryKey: ["org", "draft"],
      queryFn: () => orgApi.draft(),
      staleTime: 0,
      gcTime: 0,
    }),
};
